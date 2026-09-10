/*
 * Blinders — content script (isolated world).
 *
 *  1. Blurs thumbnails the model judges unproductive, and disarms their links.
 *  2. Shields the watch page before a frame renders, then blocks or releases.
 *  3. Strips Shorts entry points from the chrome of the site.
 */
(function () {
  'use strict';

  var M = self.BlindersModel;
  var CH = self.BlindersChannels;
  var doc = document;
  var root = doc.documentElement;

  var state = {
    enabled: true,
    ready: false,
    allow: Object.create(null),   // videoId -> true (user-reported false positive)
    verdicts: Object.create(null),// videoId -> boolean(block)
    chan: Object.create(null),    // channel -> [unproductive, productive]
    allowChan: Object.create(null),// canonical channel key -> always allow
    blockChan: Object.create(null) // canonical channel key -> always block
  };

  var watch = { id: '', settled: false, final: false, meta: null,
                guardTimer: 0, killTimer: 0, deadline: 0, keys: [] };

  /* ----------------------------------------------------------------- utils */

  function txt(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }

  function q(el, sels) {
    for (var i = 0; i < sels.length; i++) {
      var f = el.querySelector(sels[i]);
      if (f) return f;
    }
    return null;
  }

  function idFromHref(href) {
    if (!href) return '';
    var m = /[?&]v=([\w-]{6,})/.exec(href) || /\/shorts\/([\w-]{6,})/.exec(href);
    return m ? m[1] : '';
  }

  function parseDuration(s) {
    if (!s) return 0;
    var parts = s.trim().split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    return parts.reduce(function (a, b) { return a * 60 + b; }, 0);
  }

  function send(msg, cb) {
    try { chrome.runtime.sendMessage(msg, function () { void chrome.runtime.lastError; if (cb) cb.apply(null, arguments); }); }
    catch (e) { /* extension context invalidated during reload */ }
  }

  /* ------------------------------------------------------- channel memory */

  /*
   * Titles like "ranked push" or "i can't stop" carry no usable lexical
   * signal. What does carry signal is the channel they came from: once a
   * handful of its uploads have been judged unambiguously, that verdict is
   * the best available prior for the ambiguous ones. Only confident
   * judgements are recorded, so a prior can never bootstrap itself.
   */
  var CHAN_MIN = 2;

  function chanKey(c) { return String(c || '').trim().toLowerCase().slice(0, 80); }

  function priorFor(channel) {
    var k = chanKey(channel);
    if (!k) return 0;
    var st = state.chan[k];
    if (!st) return 0;
    var n = st[0] + st[1];
    if (n < CHAN_MIN) return 0;
    return (st[1] - st[0]) / n;   // −1 all distraction … +1 all worthwhile
  }

  function isChanAllowed(keys) {
    for (var i = 0; i < keys.length; i++) {
      if (state.allowChan[keys[i]]) return true;
    }
    return false;
  }

  function isChanBlocked(keys) {
    for (var i = 0; i < keys.length; i++) {
      if (state.blockChan[keys[i]]) return true;
    }
    return false;
  }

  var chanDirty = false;
  function recordChannel(channel, unproductive) {
    var k = chanKey(channel);
    if (!k) return;
    var st = state.chan[k] || (state.chan[k] = [0, 0]);
    var slot = unproductive ? 0 : 1;
    if (st[slot] >= 20) return;              // saturate; stay responsive to change
    st[slot]++;
    chanDirty = true;
  }

  setInterval(function () {
    if (!chanDirty) return;
    chanDirty = false;
    send({ type: 'chan', chan: state.chan });
  }, 3000);

  /* -------------------------------------------------------- card extraction */

  var CARD_SEL = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-playlist-panel-video-renderer',
    'ytd-reel-item-renderer',
    'yt-lockup-view-model'
  ].join(',');

  var TITLE_SEL = [
    '#video-title', 'a#video-title-link', 'h3 a#video-title',
    '.yt-lockup-metadata-view-model-wiz__title',
    '.yt-lockup-metadata-view-model__title',
    'h3 a[title]', 'h3 span[role="text"]', '#video-title-link'
  ];

  var CHANNEL_SEL = [
    'ytd-channel-name #text', '#channel-name #text', '#channel-name a',
    'ytd-channel-name yt-formatted-string',
    '.yt-content-metadata-view-model-wiz__metadata-row a',
    '.yt-content-metadata-view-model__metadata-row a',
    'a[href^="/@"]', 'a[href^="/channel/"]', 'a[href^="/c/"]'
  ];

  var DUR_SEL = [
    'ytd-thumbnail-overlay-time-status-renderer #text',
    'ytd-thumbnail-overlay-time-status-renderer',
    '.badge-shape-wiz__text',
    '.ytThumbnailOverlayBadgeViewModelHost',
    '.yt-badge-shape__text'
  ];

  var THUMB_SEL = [
    'ytd-thumbnail', 'a#thumbnail', 'yt-thumbnail-view-model',
    '.yt-thumbnail-view-model', '.ytThumbnailViewModelHost',
    '.yt-lockup-view-model-wiz__content-image', '#thumbnail'
  ];

  function readCard(card) {
    var tEl = q(card, TITLE_SEL);
    var title = tEl ? (tEl.getAttribute('title') || txt(tEl)) : '';
    if (!title) {
      var alt = card.querySelector('a[aria-label]');
      if (alt) title = alt.getAttribute('aria-label') || '';
    }
    var cEl = q(card, CHANNEL_SEL);
    var channel = cEl ? (cEl.getAttribute('title') || txt(cEl)) : '';
    var cHref = card.querySelector('a[href^="/@"], a[href^="/channel/"], a[href^="/c/"], a[href^="/user/"]');
    var dEl = q(card, DUR_SEL);
    var link = card.querySelector('a[href*="watch?v="], a[href*="/shorts/"]');
    var href = link ? link.getAttribute('href') : '';
    return {
      title: title,
      channel: channel,
      channelHref: cHref ? cHref.getAttribute('href') : '',
      durationSec: parseDuration(txt(dEl)),
      isShort: /\/shorts\//.test(href || '') || card.tagName === 'YTD-REEL-ITEM-RENDERER',
      videoId: idFromHref(href)
    };
  }

  /* ------------------------------------------------------------ veil paint */

  function veilFor(card) {
    var host = q(card, THUMB_SEL) || card;
    if (host.querySelector(':scope > .bl-veil')) return;
    host.classList.add('bl-anchor');
    var v = doc.createElement('div');
    v.className = 'bl-veil';
    v.innerHTML = '<span class="bl-veil__chip"><i class="bl-veil__dot"></i>Blinders</span>';
    v.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
    host.appendChild(v);
  }

  function unveil(card) {
    card.classList.remove('bl-hit');
    var vs = card.querySelectorAll('.bl-veil');
    for (var i = 0; i < vs.length; i++) vs[i].remove();
    var as = card.querySelectorAll('.bl-anchor');
    for (var j = 0; j < as.length; j++) as[j].classList.remove('bl-anchor');
  }

  function judgeCard(card) {
    var d = readCard(card);
    if (!d.title || d.title.length < 3) return;

    // YouTube recycles renderer nodes; re-judge whenever the payload changes.
    var key = d.videoId + '|' + d.title;
    if (card.__blKey === key) return;
    card.__blKey = key;

    if (d.videoId && state.allow[d.videoId]) { unveil(card); card.classList.remove('bl-short'); return; }

    // A Short in the grid gets removed outright rather than blurred — the
    // whole point of the Shorts rule is that the entry point disappears.
    if (d.isShort) { card.classList.add('bl-short'); return; }
    card.classList.remove('bl-short');

    // A channel the user has named settles it either way, before scoring.
    var cardKeys = CH.keysFor(d.channel, d.channelHref);
    if (isChanBlocked(cardKeys)) { card.classList.add('bl-hit'); veilFor(card); return; }
    if (isChanAllowed(cardKeys)) { unveil(card); return; }

    var prior = priorFor(d.channel);
    var r = M.classify(d, { channelPrior: prior });

    // Record only unambiguous, prior-free evidence, so channel memory is
    // built from what the lexicon is sure about — never from its own output.
    var base = prior ? M.classify(d) : r;
    if (base.p >= 0.85) recordChannel(d.channel, true);
    else if (base.p <= 0.25) recordChannel(d.channel, false);

    if (d.videoId) state.verdicts[d.videoId] = r.block;

    if (r.block) {
      card.classList.add('bl-hit');
      veilFor(card);
      if (d.videoId) send({ type: 'verdict', videoId: d.videoId, block: true });
    } else {
      unveil(card);
      if (d.videoId) send({ type: 'verdict', videoId: d.videoId, block: false });
    }
  }

  function sweep() {
    if (!state.enabled) return;
    var cards = doc.querySelectorAll(CARD_SEL);
    for (var i = 0; i < cards.length; i++) judgeCard(cards[i]);
    stripShorts();
  }

  // Force a fresh verdict on every card — the per-card cache key is the video,
  // so a settings change would otherwise not be noticed until the DOM changed.
  function rejudge() {
    var cards = doc.querySelectorAll(CARD_SEL);
    for (var i = 0; i < cards.length; i++) cards[i].__blKey = null;
    schedule();
    if (isWatch() || isShortsPage()) startWatchGuard();
  }

  function clearAll() {
    var cards = doc.querySelectorAll('.bl-hit');
    for (var i = 0; i < cards.length; i++) { unveil(cards[i]); cards[i].__blKey = null; }
    var hidden = doc.querySelectorAll('.bl-shorts-hidden');
    for (var j = 0; j < hidden.length; j++) hidden[j].classList.remove('bl-shorts-hidden');
    var shorts = doc.querySelectorAll('.bl-short');
    for (var k = 0; k < shorts.length; k++) shorts[k].classList.remove('bl-short');
  }

  /* ---------------------------------------------------------------- shorts */

  function stripShorts() {
    if (!state.enabled) return;

    // Nav entries: only the entry whose OWN link is the Shorts destination.
    var nav = doc.querySelectorAll('ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer');
    for (var i = 0; i < nav.length; i++) {
      var e = nav[i];
      if (e.classList.contains('bl-shorts-hidden')) continue;
      var a = e.querySelector('a#endpoint, a');
      var h = a ? (a.getAttribute('href') || '') : '';
      var lbl = (a && (a.getAttribute('title') || a.getAttribute('aria-label'))) || txt(e);
      if (h === '/shorts' || /^shorts$/i.test(lbl.trim())) e.classList.add('bl-shorts-hidden');
    }

    // Filter chips labelled exactly "Shorts".
    var chips = doc.querySelectorAll('yt-chip-cloud-chip-renderer');
    for (var j = 0; j < chips.length; j++) {
      if (!chips[j].classList.contains('bl-shorts-hidden') && /^shorts$/i.test(txt(chips[j]))) {
        chips[j].classList.add('bl-shorts-hidden');
      }
    }

    // Shelves: only genuine Shorts shelves. A news or music shelf may well
    // contain a Short somewhere inside it — hiding the whole shelf for that
    // would take a dozen legitimate videos with it.
    var shelves = doc.querySelectorAll('ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, ytd-shelf-renderer, grid-shelf-view-model');
    for (var k = 0; k < shelves.length; k++) {
      var sh = shelves[k];
      if (sh.classList.contains('bl-shorts-hidden')) continue;
      var isShortsShelf =
        sh.hasAttribute('is-shorts') ||
        sh.tagName === 'YTD-REEL-SHELF-RENDERER' ||
        sh.tagName === 'GRID-SHELF-VIEW-MODEL' ||
        /^shorts$/i.test(txt(q(sh, ['#title', '.shelf-title', 'h2 span', '#title-text'])));
      if (isShortsShelf) {
        sh.classList.add('bl-shorts-hidden');
        var sec = sh.closest('ytd-rich-section-renderer');
        if (sec) sec.classList.add('bl-shorts-hidden');
      }
    }
  }

  /* ------------------------------------------------------------ watch page */

  function isWatch() { return location.pathname === '/watch'; }
  function isShortsPage() { return location.pathname.indexOf('/shorts/') === 0; }
  function currentId() {
    if (isShortsPage()) return location.pathname.split('/')[2] || '';
    return new URLSearchParams(location.search).get('v') || '';
  }

  /*
   * While a verdict is pending the player is held silent and stopped.
   *
   * YouTube reuses one <video> element across in-page navigations, so the
   * "restore afterwards" values can't be snapshotted at suppression time —
   * by then the element may still carry the mute WE applied to the previous
   * video. Instead we keep the last state that was demonstrably not ours.
   */
  var userAudio = { muted: false, volume: 1 };
  var suppressedPlay = false;

  function isOurSuppression(v) { return v.muted && v.volume === 0; }

  function killMedia() {
    var vids = doc.querySelectorAll('video, audio');
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      try {
        if (!isOurSuppression(v)) userAudio = { muted: v.muted, volume: v.volume };
        if (!v.paused) { suppressedPlay = true; v.pause(); }
        v.muted = true;
        v.volume = 0;
      } catch (e) {}
    }
  }

  /* Hand the player back exactly as we found it. */
  function releaseMedia() {
    var vids = doc.querySelectorAll('video, audio');
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      try {
        if (!isOurSuppression(v)) continue;      // we never touched this one
        v.muted = userAudio.muted;
        v.volume = userAudio.volume;
        if (suppressedPlay && v.paused) {
          var p = v.play();
          if (p && typeof p.catch === 'function') p.catch(function () {});
        }
      } catch (e) {}
    }
    suppressedPlay = false;
  }

  // Capture-phase interception: stops autoplay audio before the first frame.
  doc.addEventListener('play', function (e) {
    if (state.enabled && !watch.settled && (isWatch() || isShortsPage())) {
      try {
        if (!isOurSuppression(e.target)) {
          userAudio = { muted: e.target.muted, volume: e.target.volume };
        }
        suppressedPlay = true;
        e.target.pause();
        e.target.muted = true;
        e.target.volume = 0;
      } catch (err) {}
    }
  }, true);

  function shieldOn() { root.classList.add('bl-shield'); }
  function shieldOff() { root.classList.remove('bl-shield'); }

  function scrapeWatchMeta() {
    var h1 = q(doc, ['ytd-watch-metadata h1 yt-formatted-string', 'ytd-watch-metadata h1', 'h1.ytd-watch-metadata', 'h1.title']);
    var ch = q(doc, ['ytd-video-owner-renderer #channel-name a', '#owner #channel-name a', 'ytd-channel-name#channel-name a']);
    var title = txt(h1);
    if (!title) {
      var dt = doc.title.replace(/\s*-\s*YouTube\s*$/, '').trim();
      if (dt && dt.toLowerCase() !== 'youtube') title = dt;
    }
    if (!title) return null;
    return {
      title: title,
      channel: txt(ch),
      channelHref: ch ? ch.getAttribute('href') : '',
      category: '', durationSec: 0, isShort: isShortsPage()
    };
  }

  /**
   * @param {boolean} block
   * @param {object}  data
   * @param {boolean} [final=true] False marks a verdict reached on thin
   *        evidence (title + channel only). It is acted on immediately, but
   *        stays open to revision if the real metadata turns up afterwards.
   */
  function settle(block, data, final) {
    watch.settled = true;
    watch.final = final !== false;
    clearInterval(watch.guardTimer);
    watch.guardTimer = 0;
    if (block) {
      renderBlock(data);
      killMedia();
      // Held on the watch object and cleared on the next navigation — an
      // unowned interval here leaks one timer per blocked video per session.
      clearInterval(watch.killTimer);
      watch.killTimer = setInterval(killMedia, 400);
      send({ type: 'blocked', videoId: watch.id, title: (data && data.title) || '' });
    } else {
      shieldOff();
      releaseMedia();
    }
  }

  function startWatchGuard() {
    var id = currentId();
    watch.id = id;
    watch.settled = false;
    watch.final = false;
    watch.meta = null;
    watch.keys = [];
    watch.deadline = Date.now() + 4000;
    clearInterval(watch.killTimer);
    watch.killTimer = 0;
    suppressedPlay = false;
    removeBlock();

    if (!state.enabled || !id) { shieldOff(); watch.settled = true; return; }

    if (isShortsPage()) {
      shieldOn();
      if (!state.allow[id]) { settle(true, { title: 'Short', channel: '', short: true, p: 0.99 }); return; }
      settle(false); return;
    }
    if (!isWatch()) { shieldOff(); watch.settled = true; return; }

    shieldOn();

    if (state.allow[id]) { settle(false); return; }

    clearInterval(watch.guardTimer);
    watch.guardTimer = setInterval(tickWatch, 60);
    tickWatch();
  }

  function tickWatch() {
    if (watch.settled) return;
    killMedia();

    var id = watch.id;

    // 1. Metadata for THIS video from the page world — the richest signal
    //    available (category, duration, keywords).
    if (hasRichMeta()) { judgeRich(); return; }

    // 2. A verdict already reached for this id from a grid card.
    if (Object.prototype.hasOwnProperty.call(state.verdicts, id)) {
      if (state.verdicts[id]) { settle(true, { title: scrapedTitle(), channel: '', p: 0.9 }); return; }
    }

    // 3. DOM fallback if the page globals never arrive.
    if (Date.now() > watch.deadline) {
      var dm = scrapeWatchMeta();
      if (dm) {
        watch.keys = CH.keysFor(dm.channel, dm.channelHref, '');
        if (isChanBlocked(watch.keys)) {
          settle(true, { title: dm.title, channel: dm.channel, channelBlocked: true });
          return;
        }
        if (isChanAllowed(watch.keys)) { settle(false); return; }
        var r2 = M.classify(dm, { channelPrior: priorFor(dm.channel) });
        // Blocking on thin evidence is safe to keep; letting a video through
        // on it is not, so that stays provisional.
        settle(r2.block, { title: dm.title, channel: dm.channel, p: r2.p }, r2.block);
      }
      else settle(false, null, false);
    }
  }

  function hasRichMeta() {
    return !!(watch.meta && watch.meta.videoId && watch.meta.videoId === watch.id);
  }

  /* Decide using the full metadata. Definitive either way. */
  function judgeRich() {
    var m = watch.meta;
    watch.keys = CH.keysFor(m.channel, m.ownerUrl, m.channelId);

    if (state.allow[watch.id]) { settle(false); return; }
    if (isChanBlocked(watch.keys)) {
      settle(true, { title: m.title, channel: m.channel, channelBlocked: true });
      return;
    }
    if (isChanAllowed(watch.keys)) { settle(false); return; }

    var r = M.classify({
      title: m.title,
      channel: m.channel,
      category: m.category,
      durationSec: m.durationSec,
      badges: m.keywords,
      isShort: false
    }, { channelPrior: priorFor(m.channel) });
    settle(r.block, { title: m.title, channel: m.channel, p: r.p });
  }

  /*
   * Navigating inside YouTube reaches the watch page before the player
   * request has answered, so the first verdict can only use the title and
   * channel — exactly the evidence the feed had. When the real metadata
   * lands we judge again, and a video let through on the thin read gets
   * blocked here rather than playing on.
   */
  function reconsider() {
    if (!state.enabled || watch.final || !hasRichMeta()) return;
    judgeRich();
  }

  function scrapedTitle() {
    var dm = scrapeWatchMeta();
    return dm ? dm.title : '';
  }

  /* --------------------------------------------------------- block overlay */

  function removeBlock() {
    var old = doc.getElementById('bl-block');
    if (old) old.remove();
    root.classList.remove('bl-blocked');
  }

  function renderBlock(data) {
    removeBlock();
    data = data || {};
    var pct = Math.round(Math.min(0.99, Math.max(0.75, data.p || 0.9)) * 100);

    // Three ways to get here, and they deserve different words: a Short, a
    // channel the user themselves blocked, or the model's own judgement.
    var headline, sub, extra;
    if (data.short) {
      headline = 'Shorts are switched off.';
      sub = 'Short-form feeds are built to be hard to leave, so Blinders keeps them closed.';
      extra = '';
    } else if (data.channelBlocked) {
      headline = 'You blocked this channel.';
      sub = data.channel
        ? 'Everything from ' + esc(data.channel) + ' is on your blocklist.'
        : 'This channel is on your blocklist.';
      extra = '<p class="bl-hint">Change it in the Blinders popup, under Settings.</p>';
    } else {
      headline = 'This one won\u2019t move you forward.';
      sub = 'Classified as unproductive with ' + pct + '% confidence.';
      extra =
        '<div class="bl-meter"><i style="width:' + pct + '%"></i></div>' +
        '<div class="bl-links">' +
          '<button class="bl-report" data-act="report">wrongly blocked?</button>' +
          (watch.keys.length ? '<span class="bl-dot">\u00b7</span>' +
            '<button class="bl-report" data-act="allowchan">always allow this channel</button>' : '') +
        '</div>';
    }

    var wrap = doc.createElement('div');
    wrap.id = 'bl-block';
    wrap.innerHTML =
      '<div class="bl-card">' +
        '<div class="bl-mark">' +
          '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6ee7b7" stroke-width="1.7" stroke-linecap="round">' +
            '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.6"/><path d="M4 20L20 4"/>' +
          '</svg>' +
        '</div>' +
        '<p class="bl-eyebrow">Blinders</p>' +
        '<h1>' + headline + '</h1>' +
        '<p class="bl-sub">' + sub + '</p>' +
        (data.title ? '<p class="bl-title-quote">\u201c' + esc(data.title) + '\u201d</p>' : '<div style="height:12px"></div>') +
        '<div class="bl-actions">' +
          '<button class="bl-primary" data-act="back">Go back</button>' +
          '<button class="bl-secondary" data-act="home">YouTube home</button>' +
        '</div>' +
        extra +
      '</div>';

    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'back') {
        if (history.length > 1) history.back(); else location.href = 'https://www.youtube.com/';
      } else if (act === 'home') {
        location.href = 'https://www.youtube.com/';
      } else if (act === 'allowchan') {
        b.setAttribute('disabled', '');
        b.textContent = 'Allowing channel…';
        watch.keys.forEach(function (k) { state.allowChan[k] = true; });
        send({ type: 'allowChannel', keys: watch.keys }, function () {
          setTimeout(function () { location.reload(); }, 350);
        });
        setTimeout(function () { location.reload(); }, 900);
      } else if (act === 'report') {
        b.setAttribute('disabled', '');
        b.textContent = 'Unblocking…';
        state.allow[watch.id] = true;
        send({ type: 'report', videoId: watch.id, title: data.title || '' }, function () {
          setTimeout(function () { location.reload(); }, 350);
        });
        setTimeout(function () { location.reload(); }, 900);
      }
    });

    (doc.body || root).appendChild(wrap);
    root.classList.add('bl-blocked');
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ------------------------------------------------------------ page world */

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__blinders !== 'meta') return;
    watch.meta = e.data.payload;
    if (!watch.settled) tickWatch();
    else reconsider();
  });

  /* ---------------------------------------------------------- observers */

  // Debounced on a timer rather than requestAnimationFrame: rAF callbacks are
  // suspended while a tab is hidden, which would leave the sweep permanently
  // "pending" and the page unprotected the moment it came back into view.
  var pending = 0;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = 0; sweep(); }, 120);
  }

  var mo = new MutationObserver(schedule);
  function observe() {
    mo.observe(doc.documentElement, { childList: true, subtree: true });
  }

  /*
   * Clicking a video from inside YouTube is a client-side route change, and
   * the player starts before the URL has settled — so waiting for the URL to
   * change let roughly a second of a blocked video render. Shield on the
   * click itself, and re-arm the play interceptor, then let the guard decide.
   */
  var preShieldTimer = 0;
  function preShield() {
    if (!state.enabled) return;
    watch.settled = false;
    shieldOn();
    killMedia();
    clearTimeout(preShieldTimer);
    preShieldTimer = setTimeout(function () {
      // The navigation never happened (or went somewhere harmless).
      if (!isWatch() && !isShortsPage()) { shieldOff(); watch.settled = true; }
    }, 6000);
  }

  doc.addEventListener('click', function (e) {
    if (!state.enabled) return;
    // Only for a click that will navigate THIS tab. A cmd/ctrl/middle click or
    // a target="_blank" link opens elsewhere, and shielding here would blank
    // the video the user is still watching.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var el = e.target;
    if (!el || !el.closest) return;
    var a = el.closest('a[href*="/watch?v="], a[href*="/shorts/"]');
    if (!a || a.target === '_blank') return;
    preShield();
  }, true);

  window.addEventListener('yt-navigate-start', preShield, true);

  var lastUrl = location.href;
  function onNav() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    removeBlock();
    startWatchGuard();
    schedule();
  }
  ['yt-navigate-start', 'yt-navigate-finish', 'popstate'].forEach(function (ev) {
    window.addEventListener(ev, onNav, true);
  });
  setInterval(onNav, 300);          // belt-and-braces for YouTube's SPA router
  setInterval(schedule, 1200);      // catches virtualised list recycling

  /* -------------------------------------------------------------- bootstrap */

  function applyEnabled(on) {
    state.enabled = !!on;
    root.classList.toggle('bl-on', state.enabled);
    if (!state.enabled) {
      clearAll();
      shieldOff();
      releaseMedia();
      removeBlock();
      watch.settled = true;
      clearInterval(watch.guardTimer);
      clearInterval(watch.killTimer);
      watch.killTimer = 0;
    } else {
      startWatchGuard();
      schedule();
    }
  }

  // Shield instantly — before we even know the setting — so no unjudged frame
  // is ever painted. Released within a tick or two if Blinders is off.
  if (isWatch() || isShortsPage()) shieldOn();

  // Settings come straight from storage rather than through the service
  // worker. A cold-started MV3 worker can answer late or not at all, and the
  // failure mode there is silent: empty lists, so nothing gets blocked.
  chrome.storage.local.get(
    ['enabled', 'allow', 'allowChannels', 'blockChannels', 'chan', 'lexAdd', 'lexOff'],
    function (d) {
      void chrome.runtime.lastError;
      d = d || {};
      state.ready = true;
      (d.allow || []).forEach(function (id) { state.allow[id] = true; });
      (d.allowChannels || []).forEach(function (k) { state.allowChan[k] = true; });
      (d.blockChannels || []).forEach(function (k) { state.blockChan[k] = true; });
      if (d.chan) state.chan = d.chan;
      M.setCustomLexicon({ add: d.lexAdd || [], off: d.lexOff || [] });
      applyEnabled(d.enabled !== false);
    }
  );

  // If storage itself is slow, don't hold the shield forever.
  setTimeout(function () { if (!state.ready) { applyEnabled(true); } }, 1200);

  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== 'local') return;
    if (ch.enabled) applyEnabled(ch.enabled.newValue !== false);
    if (ch.allow) {
      state.allow = Object.create(null);
      (ch.allow.newValue || []).forEach(function (id) { state.allow[id] = true; });
      rejudge();
    }
    if (ch.allowChannels) {
      state.allowChan = Object.create(null);
      (ch.allowChannels.newValue || []).forEach(function (k) { state.allowChan[k] = true; });
      rejudge();
    }
    if (ch.blockChannels) {
      state.blockChan = Object.create(null);
      (ch.blockChannels.newValue || []).forEach(function (k) { state.blockChan[k] = true; });
      rejudge();
    }
    if (ch.lexAdd || ch.lexOff) {
      chrome.storage.local.get(['lexAdd', 'lexOff'], function (d) {
        void chrome.runtime.lastError;
        d = d || {};
        M.setCustomLexicon({ add: d.lexAdd || [], off: d.lexOff || [] });
        rejudge();
      });
    }
  });

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function () { observe(); sweep(); });
  } else { observe(); sweep(); }
  observe();
})();
