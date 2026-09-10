'use strict';

var CH = self.BlindersChannels;
var M  = self.BlindersModel;

var toggle       = document.getElementById('toggle');
var stateEl      = document.getElementById('state');
var countEl      = document.getElementById('count');
var settingsBtn  = document.getElementById('settingsToggle');
var settingsBody = document.getElementById('settingsBody');
var videoCount   = document.getElementById('videoCount');
var clearVideos  = document.getElementById('clearVideos');

var enabled = true;
var videos = [];

/* ------------------------------------------------------------- storage */

function read(keys) {
  return new Promise(function (r) {
    chrome.storage.local.get(keys, function (d) { void chrome.runtime.lastError; r(d || {}); });
  });
}
function write(obj) {
  return new Promise(function (r) {
    chrome.storage.local.set(obj, function () { void chrome.runtime.lastError; r(); });
  });
}
function ask(msg) {
  return new Promise(function (r) {
    chrome.runtime.sendMessage(msg, function (res) { void chrome.runtime.lastError; r(res || {}); });
  });
}

/* -------------------------------------------------------------- header */

function renderHeader(blockedToday) {
  document.body.classList.toggle('is-on', enabled);
  toggle.setAttribute('aria-checked', String(enabled));
  stateEl.textContent = enabled ? 'On' : 'Off';
  if (!enabled) {
    countEl.textContent = 'Paused';
  } else if (blockedToday > 0) {
    countEl.textContent = blockedToday + (blockedToday === 1 ? ' block today' : ' blocks today');
  } else {
    countEl.textContent = 'Watching for distractions';
  }
}

toggle.addEventListener('click', async function () {
  enabled = !enabled;
  renderHeader(null);
  await ask({ type: 'setEnabled', value: enabled });
  var res = await ask({ type: 'stats' });
  enabled = res.enabled !== false;
  renderHeader(res.blockedToday || 0);
});

settingsBtn.addEventListener('click', function () {
  var open = settingsBtn.getAttribute('aria-expanded') === 'true';
  settingsBtn.setAttribute('aria-expanded', String(!open));
  settingsBody.hidden = open;
});

/* ------------------------------------------------------- channel lists */

/*
 * The allow and block lists behave identically apart from their storage key
 * and their wording, so one controller drives both. They are mutually
 * exclusive: naming a channel on one list takes it off the other, because
 * holding both would be a contradiction the content script has to guess at.
 */
function channelList(opts) {
  var form  = document.getElementById(opts.prefix + 'Form');
  var input = document.getElementById(opts.prefix + 'Input');
  var note  = document.getElementById(opts.prefix + 'Note');
  var list  = document.getElementById(opts.prefix + 'List');
  var empty = document.getElementById(opts.prefix + 'Empty');
  var keys = [];
  var other = null;                        // wired up after both exist

  function say(text, kind) {
    note.textContent = text;
    note.className = 'note' + (kind ? ' is-' + kind : '');
    note.hidden = !text;
    if (text) setTimeout(function () { note.hidden = true; }, 3600);
  }

  function render() {
    list.textContent = '';
    keys.forEach(function (key) {
      var li = document.createElement('li');
      var name = document.createElement('span');
      name.textContent = CH.label(key);
      name.title = key;
      var del = document.createElement('button');
      del.type = 'button';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Remove ' + CH.label(key));
      del.addEventListener('click', async function () {
        keys = keys.filter(function (k) { return k !== key; });
        await save();
        render();
      });
      li.appendChild(name);
      li.appendChild(del);
      list.appendChild(li);
    });
    empty.hidden = keys.length > 0;
  }

  function save() {
    var o = {};
    o[opts.storageKey] = keys;
    return write(o);
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var raw = input.value.trim();
    if (!raw) return;

    var key = CH.fromInput(raw);
    if (!key) {
      say('That does not look like a channel link. Try youtube.com/@name.', 'error');
      return;
    }
    if (keys.indexOf(key) !== -1) {
      say(CH.label(key) + ' is already here.', null);
      input.value = '';
      return;
    }

    keys.push(key);
    var moved = other && other.drop(key);
    await save();
    if (moved) await other.save();
    input.value = '';
    render();
    if (moved) other.render();
    say(CH.label(key) + ' ' + opts.confirm + (moved ? ' (moved off the other list)' : ''), opts.tone);
  });

  return {
    render: render,
    save: save,
    set: function (v) { keys = v || []; render(); },
    has: function (k) { return keys.indexOf(k) !== -1; },
    drop: function (k) {
      if (keys.indexOf(k) === -1) return false;
      keys = keys.filter(function (x) { return x !== k; });
      return true;
    },
    link: function (o) { other = o; }
  };
}

var allow = channelList({
  prefix: 'allow', storageKey: 'allowChannels',
  confirm: 'will never be blurred.', tone: 'ok'
});
var block = channelList({
  prefix: 'block', storageKey: 'blockChannels',
  confirm: 'will always be blocked.', tone: 'deny'
});
allow.link(block);
block.link(allow);

/* ------------------------------------------------------ lexicon editor */

/*
 * The built-in lexicon flattened once into a searchable index. Searching it
 * is the point: before adding a term you can see whether the model already
 * covers it, and at what strength.
 */
var STRENGTH_NAME = ['strong', 'med', 'weak'];
var STRENGTH_LABEL = { strong: 'Strong', med: 'Med', weak: 'Weak' };

var BUILT_IN = (function () {
  var out = [];
  var lex = M.lexicon;
  lex.NEG.forEach(function (tier, i) {
    tier[1].forEach(function (t) { out.push({ term: t, dir: 'neg', strength: STRENGTH_NAME[i], mine: false }); });
  });
  lex.POS.forEach(function (tier, i) {
    tier[1].forEach(function (t) { out.push({ term: t, dir: 'pos', strength: STRENGTH_NAME[i], mine: false }); });
  });
  lex.GAMING.forEach(function (t) {
    out.push({ term: t, dir: 'neg', strength: 'gaming', mine: false });
  });
  return out;
})();

var lexToggle  = document.getElementById('lexToggle');
var lexBody    = document.getElementById('lexBody');
var lexSearch  = document.getElementById('lexSearch');
var lexList    = document.getElementById('lexList');
var lexSummary = document.getElementById('lexSummary');
var lexAddRow  = document.getElementById('lexAddRow');
var lexAddBtn  = document.getElementById('lexAddBtn');
var lexAddTerm = document.getElementById('lexAddTerm');
var lexNote    = document.getElementById('lexNote');
var lexCount   = document.getElementById('lexCount');

var lexAdd = [];                       // [{term, dir, strength}]
var lexOff = Object.create(null);      // term -> true
var draft = { dir: 'neg', strength: 'strong' };

function lexSay(text, kind) {
  lexNote.textContent = text;
  lexNote.className = 'note' + (kind ? ' is-' + kind : '');
  lexNote.hidden = !text;
  if (text) setTimeout(function () { lexNote.hidden = true; }, 3600);
}

function saveLexicon() {
  return write({ lexAdd: lexAdd, lexOff: Object.keys(lexOff) });
}

function lexEntries() { return lexAdd.map(function (e) {
  return { term: e.term, dir: e.dir, strength: e.strength, mine: true };
}).concat(BUILT_IN); }

function updateCount() {
  var off = Object.keys(lexOff).length;
  lexCount.textContent = (BUILT_IN.length + lexAdd.length - off) + ' terms';
}

function renderLex() {
  var qRaw = lexSearch.value.trim();
  var q = M.termKey(qRaw);
  lexList.textContent = '';

  if (!q) {
    lexSummary.textContent = 'Search to see whether a term is already covered.';
    lexSummary.className = 'note note--static';
    lexSummary.hidden = false;
    lexAddRow.hidden = true;
    updateCount();
    return;
  }

  var all = lexEntries();
  var matches = all.filter(function (e) { return e.term.indexOf(q) !== -1; });
  matches.sort(function (a, b) {
    if (a.mine !== b.mine) return a.mine ? -1 : 1;
    return a.term.length - b.term.length;
  });

  var exact = matches.filter(function (e) { return e.term === q; });
  lexSummary.textContent = matches.length
    ? matches.length + (matches.length === 1 ? ' term matches' : ' terms match')
    : 'No term matches — nothing in the lexicon covers this yet.';
  lexSummary.className = 'note note--static' + (matches.length ? '' : ' is-ok');
  lexSummary.hidden = false;

  matches.slice(0, 60).forEach(function (e) {
    var li = document.createElement('li');
    var isOff = !!lexOff[e.term];
    if (isOff) li.className = 'is-off';

    var name = document.createElement('span');
    name.className = 'term';
    name.textContent = e.term;
    name.title = e.term;

    var tag = document.createElement('span');
    tag.className = 'tag ' + (e.mine ? 'tag--mine' : (e.dir === 'pos' ? 'tag--pos' : 'tag--neg'));
    // The sign carries direction, so the tag does not depend on colour alone.
    var sign = e.dir === 'pos' ? '+' : '\u2212';
    tag.textContent = sign + ' ' + (e.mine
      ? STRENGTH_LABEL[e.strength]
      : (e.strength === 'gaming' ? 'gaming' : STRENGTH_LABEL[e.strength]));
    tag.title = (e.dir === 'pos' ? 'productive' : 'distracting') + ' · ' +
      (e.strength === 'gaming' ? 'decisive' : STRENGTH_LABEL[e.strength].toLowerCase());

    var act = document.createElement('button');
    act.type = 'button';
    act.textContent = isOff ? '↺' : '×';
    act.setAttribute('aria-label', (isOff ? 'Restore ' : 'Remove ') + e.term);
    act.addEventListener('click', async function () {
      if (e.mine && !isOff) {
        lexAdd = lexAdd.filter(function (x) { return x.term !== e.term; });
        delete lexOff[e.term];
        lexSay('“' + e.term + '” deleted.', null);
      } else if (isOff) {
        delete lexOff[e.term];
        lexSay('“' + e.term + '” restored.', 'ok');
      } else {
        lexOff[e.term] = true;
        lexSay('“' + e.term + '” switched off.', 'deny');
      }
      await saveLexicon();
      renderLex();
    });

    li.appendChild(name);
    li.appendChild(tag);
    li.appendChild(act);
    lexList.appendChild(li);
  });

  // Offer to add only what is not already there verbatim.
  if (q.length > 1 && !exact.length) {
    lexAddTerm.textContent = q;
    lexAddBtn.disabled = false;
    lexAddRow.hidden = false;
  } else {
    lexAddRow.hidden = true;
  }
  updateCount();
}

lexToggle.addEventListener('click', function () {
  var open = lexToggle.getAttribute('aria-expanded') === 'true';
  lexToggle.setAttribute('aria-expanded', String(!open));
  lexBody.hidden = open;
  if (!open) lexSearch.focus();
});

lexSearch.addEventListener('input', renderLex);

lexAddRow.addEventListener('click', function (e) {
  var b = e.target.closest('.seg__btn');
  if (!b) return;
  var group = b.parentElement;
  [].forEach.call(group.children, function (c) { c.classList.remove('is-active'); });
  b.classList.add('is-active');
  if (b.dataset.dir) draft.dir = b.dataset.dir;
  if (b.dataset.strength) draft.strength = b.dataset.strength;
});

lexAddBtn.addEventListener('click', async function () {
  var term = M.termKey(lexSearch.value);
  if (term.length < 2) { lexSay('Too short to be a useful term.', 'error'); return; }
  if (lexAdd.some(function (e) { return e.term === term; })) { lexSay('You already added that.', null); return; }
  lexAdd.push({ term: term, dir: draft.dir, strength: draft.strength });
  delete lexOff[term];
  await saveLexicon();
  lexSay('“' + term + '” added as ' + (draft.dir === 'neg' ? 'distracting' : 'productive') +
         ' · ' + STRENGTH_LABEL[draft.strength].toLowerCase() + '.', draft.dir === 'neg' ? 'deny' : 'ok');
  renderLex();
});

/* --------------------------------------------------- per-video allowlist */

function renderVideos() {
  var n = videos.length;
  videoCount.textContent = n === 0
    ? 'No videos unblocked'
    : n + (n === 1 ? ' video unblocked' : ' videos unblocked');
  clearVideos.hidden = n === 0;
}

clearVideos.addEventListener('click', async function () {
  videos = [];
  await write({ allow: [] });
  renderVideos();
});

/* ------------------------------------------------------------- startup */

(async function init() {
  var res = await ask({ type: 'stats' });
  enabled = res.enabled !== false;
  renderHeader(res.blockedToday || 0);

  var d = await read(['allowChannels', 'blockChannels', 'allow', 'lexAdd', 'lexOff']);
  allow.set(d.allowChannels || []);
  block.set(d.blockChannels || []);
  videos = d.allow || [];
  renderVideos();
  lexAdd = d.lexAdd || [];
  (d.lexOff || []).forEach(function (t) { lexOff[t] = true; });
  renderLex();
})();

// Reflect changes made elsewhere (the block screen's "always allow this channel").
chrome.storage.onChanged.addListener(function (ch, area) {
  if (area !== 'local') return;
  if (ch.allowChannels) allow.set(ch.allowChannels.newValue || []);
  if (ch.blockChannels) block.set(ch.blockChannels.newValue || []);
  if (ch.allow) { videos = ch.allow.newValue || []; renderVideos(); }
  if (ch.lexAdd || ch.lexOff) {
    if (ch.lexAdd) lexAdd = ch.lexAdd.newValue || [];
    if (ch.lexOff) {
      lexOff = Object.create(null);
      (ch.lexOff.newValue || []).forEach(function (t) { lexOff[t] = true; });
    }
    renderLex();
  }
});
