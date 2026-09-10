/*
 * Blinders — channel identity helpers.
 *
 * A channel shows up in three different shapes depending on where you meet
 * it: a handle in a link (/@veritasium), a channel id (/channel/UC…), or a
 * display name rendered on a card ("Veritasium"). The user may paste any of
 * them. These functions reduce all of it to comparable keys.
 *
 * Shared by the content script and the popup.
 */
(function (root) {
  'use strict';

  function tidy(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Canonical key for anything the user might paste.
   * @returns {string|null} "@handle" | "uc…" | "name:display name"
   */
  function fromInput(input) {
    var s = String(input || '').trim();
    if (!s) return null;

    var m = /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com(\/.*)$/i.exec(s);
    var path = m ? m[1] : (s.charAt(0) === '/' ? s : null);

    if (path) {
      var handle = /^\/@([^\/?#\s]+)/.exec(path);
      if (handle) return '@' + handle[1].toLowerCase();
      var id = /^\/channel\/(UC[\w-]{16,})/i.exec(path);
      if (id) return id[1].toLowerCase();
      var legacy = /^\/(?:c|user)\/([^\/?#\s]+)/.exec(path);
      if (legacy) return 'name:' + tidy(decodeURIComponent(legacy[1]));
      return null;                       // a youtube.com URL, but not a channel
    }

    // Anything else that still looks like a web address is not a channel —
    // don't quietly file "https://example.com/foo" away as a display name.
    if (/^[a-z][\w+.-]*:\/\//i.test(s) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) return null;

    if (s.charAt(0) === '@') return '@' + tidy(s.slice(1)).replace(/\s+/g, '');
    if (/^UC[\w-]{16,}$/.test(s)) return s.toLowerCase();
    return 'name:' + tidy(s);            // plain display name
  }

  /** Every key a given card or watch page could be matched by. */
  function keysFor(displayName, href, channelId) {
    var out = [];
    var fromHref = href ? fromInput(href) : null;
    if (fromHref) out.push(fromHref);
    if (channelId && /^UC[\w-]{16,}$/i.test(channelId)) out.push(channelId.toLowerCase());
    var n = tidy(displayName);
    if (n) out.push('name:' + n);
    return out;
  }

  /** How a stored key should read in the settings list. */
  function label(key) {
    if (!key) return '';
    if (key.charAt(0) === '@') return key;
    if (key.indexOf('name:') === 0) return key.slice(5);
    return key.slice(0, 12) + '…';       // bare channel id
  }

  var api = { fromInput: fromInput, keysFor: keysFor, label: label };
  root.BlindersChannels = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
