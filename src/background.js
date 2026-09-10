/*
 * Blinders — service worker.
 * Owns persistent state: the master switch, the user's false-positive
 * allowlist, and the rolling daily block count shown in the popup + badge.
 */
'use strict';

var DEFAULTS = { enabled: true, allow: [], allowChannels: [], blockChannels: [], lexAdd: [], lexOff: [], blocked: {}, seen: {}, chan: {} };

function today() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function get(keys) {
  return new Promise(function (r) { chrome.storage.local.get(keys, r); });
}
function set(obj) {
  return new Promise(function (r) { chrome.storage.local.set(obj, r); });
}

async function paintBadge() {
  var s = await get(['enabled', 'blocked']);
  var on = s.enabled !== false;
  var n = ((s.blocked || {})[today()] || 0);
  chrome.action.setBadgeBackgroundColor({ color: on ? '#10b981' : '#3f3f46' });
  chrome.action.setBadgeTextColor && chrome.action.setBadgeTextColor({ color: '#04120c' });
  chrome.action.setBadgeText({ text: on ? (n > 0 ? String(n > 999 ? '999+' : n) : '') : 'off' });
}

chrome.runtime.onInstalled.addListener(async function () {
  var cur = await get(Object.keys(DEFAULTS));
  var patch = {};
  Object.keys(DEFAULTS).forEach(function (k) {
    if (cur[k] === undefined) patch[k] = DEFAULTS[k];
  });
  if (Object.keys(patch).length) await set(patch);
  paintBadge();
});

chrome.runtime.onStartup.addListener(paintBadge);

chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  (async function () {
    var s = await get(['enabled', 'allow', 'allowChannels', 'blockChannels', 'blocked', 'seen', 'chan']);

    if (msg.type === 'init') {
      reply({
        enabled: s.enabled !== false,
        allow: s.allow || [],
        allowChannels: s.allowChannels || [],
        blockChannels: s.blockChannels || [],
        chan: s.chan || {}
      });
      paintBadge();
      return;
    }

    if (msg.type === 'blocked') {
      // Count each video at most once per day so the number means something.
      var seen = s.seen || {};
      var day = today();
      if (seen.day !== day) seen = { day: day, ids: {} };
      if (msg.videoId && !seen.ids[msg.videoId]) {
        seen.ids[msg.videoId] = 1;
        var blocked = s.blocked || {};
        blocked[day] = (blocked[day] || 0) + 1;
        Object.keys(blocked).forEach(function (k) { if (k !== day) delete blocked[k]; });
        await set({ blocked: blocked, seen: seen });
      } else {
        await set({ seen: seen });
      }
      paintBadge();
      reply({ ok: true });
      return;
    }

    if (msg.type === 'report') {
      var allow = s.allow || [];
      if (msg.videoId && allow.indexOf(msg.videoId) === -1) {
        allow.push(msg.videoId);
        if (allow.length > 500) allow = allow.slice(-500);
        await set({ allow: allow });
      }
      reply({ ok: true });
      return;
    }

    if (msg.type === 'allowChannel') {
      var list = s.allowChannels || [];
      var keys = msg.keys || [];
      keys.forEach(function (k) {
        if (k && list.indexOf(k) === -1) list.push(k);
      });
      if (list.length > 300) list = list.slice(-300);
      // The two lists contradict each other, so allowing lifts any block.
      var blocked = (s.blockChannels || []).filter(function (k) { return keys.indexOf(k) === -1; });
      await set({ allowChannels: list, blockChannels: blocked });
      reply({ ok: true, allowChannels: list });
      return;
    }

    if (msg.type === 'chan') {
      // Merge rather than overwrite: several tabs observe different feeds.
      var chan = s.chan || {};
      var incoming = msg.chan || {};
      for (var k in incoming) {
        if (!Object.prototype.hasOwnProperty.call(incoming, k)) continue;
        var a = chan[k] || [0, 0], b = incoming[k];
        chan[k] = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      }
      // Keep the table bounded; drop the least-observed channels first.
      var keys = Object.keys(chan);
      if (keys.length > 800) {
        keys.sort(function (x, y) { return (chan[x][0] + chan[x][1]) - (chan[y][0] + chan[y][1]); });
        for (var i = 0; i < keys.length - 800; i++) delete chan[keys[i]];
      }
      await set({ chan: chan });
      reply({ ok: true });
      return;
    }

    if (msg.type === 'stats') {
      reply({
        enabled: s.enabled !== false,
        blockedToday: ((s.blocked || {})[today()] || 0)
      });
      return;
    }

    if (msg.type === 'setEnabled') {
      await set({ enabled: !!msg.value });
      paintBadge();
      reply({ ok: true, enabled: !!msg.value });
      return;
    }

    reply({ ok: false });
  })();
  return true; // async reply
});

chrome.storage.onChanged.addListener(function (ch, area) {
  if (area === 'local' && (ch.enabled || ch.blocked)) paintBadge();
});

paintBadge();
