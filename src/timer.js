/*
 * Blinders — session stopwatch.
 *
 * One session spans the whole visit, not one page: the elapsed time is
 * derived from a single start timestamp in storage, so every YouTube tab
 * shows the same figure and navigating or opening a video never restarts it.
 * Reading the clock locally each tick also means it keeps counting while the
 * service worker is asleep.
 *
 * A session ends by going quiet rather than by being stopped — if no YouTube
 * tab has been awake for IDLE_MS, the next one to open starts a fresh count.
 */
(function () {
  'use strict';

  var BAND = 100;            // the widget stays wholly inside the top 100px
  var MARGIN = 12;
  var IDLE_MS = 15 * 60 * 1000;
  var HEARTBEAT_MS = 10000;
  var ID = 'bl-timer';

  var doc = document;
  var el = null, dot = null, out = null;
  var start = 0;
  var want = null;           // where the user put it — the value we persist
  var pos = null;             // where it currently sits, after clamping
  var pinned = false;         // true once the user has dragged it somewhere
  var placeTries = 0;
  var enabled = true;
  var dragging = false;
  var grab = { dx: 0, dy: 0 };
  var ticker = 0, beat = 0;

  /* ------------------------------------------------------------- session */

  // A tab counts as awake if someone is looking at it, or if it is still
  // playing — audio in a background tab is very much still a session.
  function awake() {
    if (!doc.hidden) return true;
    var v = doc.querySelector('video');
    return !!(v && !v.paused && !v.ended);
  }

  function adopt(session, now) {
    if (!session || !session.start || (now - (session.last || 0)) > IDLE_MS) {
      start = now;
      write(now);
      return;
    }
    // Several tabs may each think they opened the session; the earliest wins,
    // which converges without any of them having to co-ordinate.
    start = (start && start < session.start) ? start : session.start;
  }

  function write(now) {
    try {
      chrome.storage.local.set({ session: { start: start, last: now } });
    } catch (e) { /* context torn down on extension reload */ }
  }

  function heartbeat() {
    if (!enabled || !awake()) return;
    write(Date.now());
  }

  /* ------------------------------------------------------------ rendering */

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function fmt(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return h > 0 ? h + ':' + pad(m) + ':' + pad(sec) : pad(m) + ':' + pad(sec);
  }

  function render() {
    if (!el || !start) return;
    var ms = Date.now() - start;
    out.textContent = fmt(ms);
    el.title = 'Blinders — this YouTube session started at ' +
      new Date(start).toLocaleTimeString();
  }

  function build() {
    el = doc.createElement('div');
    el.id = ID;
    el.setAttribute('role', 'timer');
    el.setAttribute('aria-label', 'YouTube session time');

    dot = doc.createElement('i');
    dot.className = 'bl-timer__dot';

    out = doc.createElement('span');
    out.className = 'bl-timer__time';
    out.textContent = '00:00';

    el.appendChild(dot);
    el.appendChild(out);

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    // The widget lives over a page full of links; never let a drag navigate.
    el.addEventListener('click', function (e) { e.stopPropagation(); }, true);
    el.addEventListener('dragstart', function (e) { e.preventDefault(); });

    // The pill changes size when the page font finally loads; re-apply the
    // intended position once it settles rather than living with the clamp.
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function () { if (!dragging) reposition(); }).observe(el);
    }
  }

  function mount() {
    if (!el) build();
    // Must be in <body>. The script runs at document_start, so on the first
    // pass there is nothing to attach to yet — the watchdog below retries.
    if (!doc.body) return;
    if (el.parentNode !== doc.body) doc.body.appendChild(el);
    reposition();
    render();
  }

  function unmount() {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* -------------------------------------------------------------- placing */

  /*
   * Horizontal movement is free; vertical is clamped so the whole widget
   * stays wholly inside the top BAND pixels of the viewport. That clamp is
   * what keeps it stuck to the top however far it is dragged.
   */
  function place(x, y) {
    if (!el) return;
    // Measured from the rect, not offsetWidth/Height: those are rounded, and
    // a height of 33.5 reported as 33 lets the bottom edge slip past BAND.
    var r = el.getBoundingClientRect();
    var w = r.width;
    var h = r.height;

    // Before the stylesheet has applied, the element has no useful size and
    // clamping against it would freeze the widget somewhere arbitrary.
    if (!w || !h) {
      if (placeTries++ < 40) setTimeout(function () { place(x, y); }, 50);
      return;
    }
    placeTries = 0;

    var maxX = Math.max(MARGIN, window.innerWidth - Math.ceil(w) - MARGIN);
    var maxY = Math.max(0, BAND - Math.ceil(h));

    pos = {
      x: Math.round(Math.min(Math.max(x, MARGIN), maxX)),
      y: Math.round(Math.min(Math.max(y, 0), maxY))
    };
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
  }

  /*
   * Clamping is a display constraint, not a new preference. If the pill
   * measures tall for a moment — before YouTube's font loads, say — the
   * clamp must not overwrite where the user actually put it, or the widget
   * creeps upward a little on every reload.
   */
  function applyWant() {
    if (want) place(want.x, want.y);
  }

  /* Top right, tucked under YouTube's masthead. */
  function defaults() {
    var r = el.getBoundingClientRect();
    var w = r.width || 96;
    var h = Math.ceil(r.height) || 34;
    return { x: window.innerWidth - w - 24, y: Math.min(64, Math.max(0, BAND - h)) };
  }

  /*
   * An untouched widget keeps following the default corner as the window
   * changes size; once dragged it stays where it was put.
   */
  function reposition() {
    if (!el) return;
    if (pinned && want) applyWant();
    else { var d = defaults(); place(d.x, d.y); }
  }

  function onDown(e) {
    if (e.button !== 0) return;
    dragging = true;
    var r = el.getBoundingClientRect();
    grab.dx = e.clientX - r.left;
    grab.dy = e.clientY - r.top;
    el.classList.add('is-dragging');
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
    e.stopPropagation();
  }

  function onMove(e) {
    if (!dragging) return;
    place(e.clientX - grab.dx, e.clientY - grab.dy);
    want = pos;                       // dragging is the one thing that sets intent
    e.preventDefault();
  }

  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    pinned = true;
    el.classList.remove('is-dragging');
    try { el.releasePointerCapture(e.pointerId); } catch (err) {}
    try { chrome.storage.local.set({ timerPos: want || pos }); } catch (err) {}
  }

  /* ------------------------------------------------------------ lifecycle */

  function show() {
    mount();
    clearInterval(ticker);
    clearInterval(beat);
    ticker = setInterval(render, 1000);
    beat = setInterval(heartbeat, HEARTBEAT_MS);
    heartbeat();
  }

  function hide() {
    clearInterval(ticker); ticker = 0;
    clearInterval(beat); beat = 0;
    unmount();
  }

  function apply(on) {
    enabled = !!on;
    if (enabled) show(); else hide();
  }

  chrome.storage.local.get(['session', 'timerPos', 'enabled'], function (d) {
    void chrome.runtime.lastError;
    d = d || {};
    if (d.timerPos && typeof d.timerPos.x === 'number') { want = d.timerPos; pinned = true; }
    adopt(d.session, Date.now());
    apply(d.enabled !== false);
  });

  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== 'local') return;
    if (ch.enabled) apply(ch.enabled.newValue !== false);
    if (ch.session && ch.session.newValue) {
      var s = ch.session.newValue;
      if (s.start && (!start || s.start < start)) { start = s.start; render(); }
    }
    if (ch.timerPos && ch.timerPos.newValue && !dragging) {
      want = ch.timerPos.newValue;
      pinned = true;
      applyWant();
    }
  });

  // Coming back to a tab that has been quiet for a while is a new session.
  doc.addEventListener('visibilitychange', function () {
    if (doc.hidden || !enabled) return;
    chrome.storage.local.get(['session'], function (d) {
      void chrome.runtime.lastError;
      adopt((d || {}).session, Date.now());
      render();
    });
  });

  window.addEventListener('resize', reposition);
  if (doc.fonts && doc.fonts.ready && doc.fonts.ready.then) {
    doc.fonts.ready.then(function () { if (!dragging) reposition(); });
  }

  // Attaches once <body> exists, and re-attaches whenever YouTube rebuilds
  // the part of the page the widget was sitting in.
  setInterval(function () {
    if (enabled && (!el || !el.isConnected || el.parentNode !== doc.body)) mount();
  }, 1000);

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function () { if (enabled) mount(); });
  }
})();
