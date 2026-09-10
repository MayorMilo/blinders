/*
 * Blinders — MAIN-world probe.
 *
 * The isolated content-script world cannot see YouTube's page globals, and
 * category + duration are two of the highest-signal features the model has.
 *
 * `ytInitialPlayerResponse` only describes the video the document was loaded
 * with. Navigating inside YouTube swaps the player without rewriting that
 * global, so on an in-page navigation it still names the PREVIOUS video —
 * which would leave the watch page judging on title and channel alone, the
 * same thin evidence the feed had. So we also watch the player request that
 * every navigation makes, and read the response as it arrives.
 */
(function () {
  'use strict';

  // A fresh document loads its metadata through /player. Navigating inside
  // YouTube goes through /get_watch instead, which wraps the very same
  // playerResponse one level down (and in an array).
  var ENDPOINTS = ['youtubei/v1/player', 'youtubei/v1/get_watch'];
  var sent = '';

  function fromPlayerResponse(r) {
    if (!r || !r.videoDetails) return null;
    var d = r.videoDetails;
    var micro = (r.microformat && r.microformat.playerMicroformatRenderer) || {};
    return {
      videoId: d.videoId || '',
      title: d.title || '',
      channel: d.author || '',
      channelId: d.channelId || '',
      ownerUrl: micro.ownerProfileUrl || '',
      category: micro.category || '',
      durationSec: parseInt(d.lengthSeconds, 10) || 0,
      keywords: (d.keywords || []).slice(0, 12).join(' ')
    };
  }

  /* Find the playerResponse wherever this particular endpoint put it. */
  function extract(json) {
    if (!json || typeof json !== 'object') return null;

    var direct = fromPlayerResponse(json);
    if (direct) return direct;
    if (json.playerResponse) {
      var viaKey = fromPlayerResponse(json.playerResponse);
      if (viaKey) return viaKey;
    }
    if (Array.isArray(json)) {
      for (var i = 0; i < json.length && i < 4; i++) {
        var entry = json[i];
        if (!entry || typeof entry !== 'object') continue;
        var m = fromPlayerResponse(entry.playerResponse) || fromPlayerResponse(entry);
        if (m) return m;
      }
    }
    return null;
  }

  function parseBody(text) {
    if (typeof text !== 'string') return null;
    try {
      // Some YouTube endpoints prefix JSON to defeat script inclusion.
      return JSON.parse(text.replace(/^\)\]\}'[^\n]*\n?/, ''));
    } catch (e) { return null; }
  }

  function emit(meta) {
    if (!meta || !meta.videoId || meta.videoId === sent) return;
    sent = meta.videoId;
    window.postMessage({ __blinders: 'meta', payload: meta }, '*');
  }

  /* ------------------------------------------------- the initial document */

  function pump() {
    emit(fromPlayerResponse(window.ytInitialPlayerResponse));
  }

  var fast = setInterval(pump, 30);
  setTimeout(function () { clearInterval(fast); setInterval(pump, 800); }, 6000);
  pump();

  /* ------------------------------------------- every in-page navigation */

  function isPlayerCall(url) {
    if (typeof url !== 'string') return false;
    for (var i = 0; i < ENDPOINTS.length; i++) {
      if (url.indexOf(ENDPOINTS[i]) !== -1) return true;
    }
    return false;
  }

  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var promise = origFetch.apply(this, arguments);
      if (isPlayerCall(url)) {
        promise.then(function (res) {
          // Clone so YouTube still gets an unread body.
          try {
            res.clone().text().then(function (text) {
              try { emit(extract(parseBody(text))); } catch (e) {}
            }, function () {});
          } catch (e) {}
        }, function () {});
      }
      return promise;
    };
  }

  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    var origOpen = XHR.prototype.open;
    var origSend = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      try { this.__blPlayer = isPlayerCall(url); } catch (e) {}
      return origOpen.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      var xhr = this;
      if (xhr.__blPlayer) {
        xhr.addEventListener('load', function () {
          try { emit(extract(parseBody(xhr.responseText))); } catch (e) {}
        });
      }
      return origSend.apply(this, arguments);
    };
  }
})();
