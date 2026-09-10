/*
 * Blinders — on-device predictive relevance model.
 *
 * A linear scoring model over lexical, channel-reputation, category and
 * presentation features, squashed through a logistic to yield
 * P(unproductive | video). No network calls; runs in ~0.05ms per video.
 *
 *   z    = Σ wᵢ·xᵢ   (positive z ⇒ productive)
 *   p    = σ(-K·z)   K = 0.55
 *   block if p ≥ 0.75  (≈ z ≤ -2.0)
 *
 * Productive  = academic explainers, documentaries, reputable news,
 *               music videos, technical tutorials.
 * Unproductive= gaming, commentary/drama, reality & dating, memes,
 *               laugh-out-loud comedy, clickbait challenge/vlog content.
 */
(function (root) {
  'use strict';

  var W = { STRONG: 2.2, MED: 1.3, WEAK: 0.7, FAINT: 0.35 };

  /* ---------------------------------------------------------------- lexicon */

  // Terms containing a space are matched as phrases; single tokens are
  // matched on word boundaries so "war" never fires inside "software".
  var NEG = [
    [W.STRONG, [
      // commentary / drama
      'commentary', 'drama', 'exposed', 'exposing', 'apology video',
      'reacts to', 'reacting to', 'i react', 'react to', 'tier list', 'cringe',
      'cringiest', 'the truth about', 'allegations', 'clout', 'internet drama',
      'spilling the tea', 'beef with',
      // reality / dating
      'blind date', 'speed dating', 'dating show', 'reality show', 'reality tv',
      'love island', 'the bachelor', 'bachelorette', '90 day fiance', 'catfish',
      'dating app', 'situationship', 'rizz', 'my ex', 'we broke up', 'breaking up with',
      'who will she choose', 'who will he choose', 'i chose', 'dating 10',
      // memes / lol comedy
      'guess the', 'try not to laugh', 'meme', 'memes', 'dank', 'shitpost', 'brainrot', 'skibidi',
      'funny moments', 'funniest moments', 'fail compilation', 'epic fails',
      'tiktok compilation', 'cursed', 'prank', 'pranks', 'pranking', 'roast',
      'comedy skit', 'stand up comedy', 'impressions', 'crackhead',
      'laugh', 'laughs', 'laughing', 'comedian', 'open mic', 'punchline',
      // challenge / stunt vlog
      'mukbang', 'asmr', 'grwm', 'get ready with me', 'day in my life',
      'last to leave', 'hide and seek', 'survived 100', '100 days in',
      'i spent 24 hours', '24 hours in', '24 hour challenge', 'eating only',
      'i spent', 'we spent', 'hours in a', 'hours straight', 'days straight',
      'worst moments', 'best moments of', 'most dramatic',
      'gone wrong', 'gone sexual', 'do not watch'
    ]],
    [W.MED, [
      'vlog', 'vlogs', 'vlogging', 'storytime', 'story time', 'haul', 'room tour',
      'what i eat in a day', 'challenge', 'challenges', 'compilation', 'tiktok',
      'tiktoks', 'shorts', 'skit', 'sketch comedy', 'ranking every', 'ranking all',
      'i rank', 'worst of', 'rating', 'reviewing your', 'responding to',
      'stream highlights', 'best moments', 'clutch', 'montage', 'edit', 'edits',
      'girlfriend', 'boyfriend', 'crush', 'flirting', 'tinder', 'hinge',
      'celebrity', 'gossip', 'unboxing', 'giveaway', 'giving away', 'clickbait',
      'you won t believe', 'shocking', 'insane', 'crazy', 'nobody expected',
      'caught on camera', 'creepypasta', 'scary stories', 'haunted', 'at 3am',
      'reaction', 'of all time', 'should have ended', 'muscle car', 'supercar',
      'most controversial', 'box opening', 'rarest', 'elite trainer',
      'top 10', 'top 5', 'top 20', 'i beat', 'i bought a', 'we bought a',
      'rate themselves', 'rate my',
      'rate each other', 'omegle', 'braindead', 'balance changes', 'broken comp',
      'social experiment', 'wheel of', 'blind ranking', 'moments', 'timed moments',
      'gooning', 'goon', 'unhinged', 'world record',
      'day trading', 'get rich', 'passive income', 'side hustle', 'make money fast',
      'i asked', 'asking strangers', 'asking people', 'street interview',
      'ruined my life', 'changed my life', 'why i quit', 'doomscrolling'
    ]],
    [W.WEAK, [
      'funny', 'hilarious', 'lol', 'lmao', 'wtf', 'omg', 'epic', 'ultimate',
      'best ever', 'worst ever', 'i tried', 'we tried',
      'trolling', 'troll', 'rage', 'toxic', 'obsessed', 'addicted', 'weird',
      'awkward', 'embarrassing', 'fans', 'fandom', 'stan', 'tea', 'petty',
      'game', 'games', 'played', 'playing', 'stream', 'streamer', 'clip', 'clips',
      'best of', 'hobby', 'obsession', 'stupid', 'dumb', 'trash', 'goated', 'cooked',
      'minutes of', 'hours of', 'taste test', 'durability test'
    ]]
  ];

  /*
   * Gaming is treated as its own decisive feature rather than one more lexical
   * hit: "speedrun explained" and "gameplay tutorial" would otherwise be
   * rescued by their productive-sounding second half. When gaming fires, the
   * productive lexicon is also damped — a trusted channel is what rescues a
   * genuine technical video about a game (see GAMING_DAMP below).
   */
  var GAMING = [
    'gameplay', 'lets play', 'let s play', 'playthrough', 'speedrun', 'speedrunning',
    'speedrunner', 'minecraft', 'fortnite', 'roblox', 'valorant', 'league of legends',
    'call of duty', 'warzone', 'apex legends', 'among us', 'overwatch', 'counter strike',
    'csgo', 'cs2', 'rocket league', 'fall guys', 'elden ring', 'dark souls', 'genshin',
    'gta', 'brawl stars', 'clash royale', 'dead by daylight', 'phasmophobia', 'fnaf',
    'noob vs pro', 'hardcore minecraft', 'video game', 'video games', 'gaming', 'gamer',
    'gamers', 'twitch stream', 'twitch clips', 'battle royale', 'victory royale',
    'ranked grind', 'aim training', 'loadout', 'speedrun world record', 'nuzlocke',
    'pvp', 'raid boss', 'boss fight', 'no hit run', 'randomizer', 'modpack',
    'trade offer', 'case opening', 'skin trade', 'sweats', 'cheaters', 'aimbot',
    'ranked gameplay', 'ranked grind', 'ranked lobby', 'controller player',
    'kd ratio', 'killstreak', 'wallhack', 'esports', 'in game', 'in-game',
    'gaming setup', 'nerf', 'buffed', 'meta build', 'loot', 'grinding', 'lucky blocks',
    'pokemon', 'tf2', 'geoguessr', 'zelda', 'terraria', 'stardew', 'skyrim',
    'palworld', 'valheim', 'undertale', 'deltarune', 'steam account', 'steam library',
    'osu', 'bloxgolf', 'speedrunning', 'r6', 'rainbow six', 'gacha',
    'sim racing', 'merge tactics', 'prop hunt', 'angry birds', 'forza', 'steam games',
    'elo', 'ranked match', 'lobby wipe', 'roblox game', 'game pass',
    'cities skylines', 'city skylines', 'cyberpunk 2077', 'game lore', 'full lore',
    'robux', 'hog cycle', 'deck', 'ranked push', 'gamemode', 'gamemodes',
    'pvz', 'plants vs zombies', 'halo ce', 'gargantuar', 'zombie game'
  ];
  var GAMING_W = 3.6;
  var GAMING_DAMP = 0.5;

  var POS = [
    [W.STRONG, [
      // academic
      'lecture', 'lectures', 'professor', 'university', 'seminar', 'colloquium',
      'full course', 'crash course', 'introduction to', 'intro to', 'fundamentals of',
      'explained', 'explains', 'explaining', 'explainer', 'explanation',
      'neuroscientist', 'scientist explains', 'doctor explains', 'expert explains',
      'professor explains', 'historian', 'economist explains', 'theorem', 'proof', 'derivation',
      'actually works', 'really works', 'how they work',
      'derive', 'calculus', 'linear algebra', 'differential equations', 'integral',
      'topology', 'organic chemistry', 'biochemistry', 'thermodynamics',
      'quantum mechanics', 'quantum physics', 'general relativity', 'electromagnetism',
      'statistics', 'probability theory', 'econometrics', 'microeconomics',
      'macroeconomics', 'neuroscience', 'genetics', 'photosynthesis', 'mitosis',
      'the science of', 'how it works', 'how does it work', 'how do they', 'why do',
      'research paper', 'paper explained', 'visual proof', 'the essence of',
      // documentary
      'documentary', 'docuseries', 'full documentary', 'the history of', 'history of',
      'rise and fall', 'untold story', 'investigation', 'the making of', 'archival',
      'a brief history', 'inside the',
      // news
      'breaking news', 'live news', 'press conference', 'press briefing', 'election',
      'parliament', 'the senate', 'supreme court', 'white house', 'geopolitics',
      'foreign policy', 'inflation', 'central bank', 'earnings call', 'full interview',
      'panel discussion', 'analysis of',
      // technical
      'tutorial', 'walkthrough tutorial', 'how to build', 'build a', 'coding',
      'programming', 'python', 'javascript', 'typescript', 'react', 'kubernetes',
      'docker', 'postgres', 'sql', 'database', 'algorithm', 'algorithms',
      'data structures', 'system design', 'machine learning', 'neural network',
      'deep learning', 'transformer', 'compiler', 'operating system', 'linux',
      'devops', 'terraform', 'regex', 'refactoring', 'in 100 seconds',
      'for beginners', 'step by step', 'masterclass', 'cheat sheet', 'from scratch',
      // music
      'official music video', 'official video', 'official audio', 'lyric video',
      'lyrics', 'live performance', 'tiny desk', 'full album', 'the album',
      'study music', 'music to study', 'focus music', 'lofi', 'lo fi',
      'sleep music', 'ambient', 'white noise', 'binaural', 'relax', 'to relax',
      'orchestra', 'symphony', 'concerto', 'acoustic version', 'live session',
      'boiler room', 'essential mix', 'audio visualizer'
    ]],
    [W.MED, [
      'science', 'physics', 'chemistry', 'biology', 'mathematics', 'math', 'maths',
      'engineering', 'economics', 'philosophy', 'psychology', 'astronomy',
      'archaeology', 'medicine', 'anatomy', 'climate', 'evolution', 'quantum',
      'theory', 'hypothesis', 'experiment', 'case study', 'deep dive', 'breakdown',
      'guide', 'course', 'lesson', 'chapter', 'syllabus', 'exam review', 'revision',
      'api', 'framework', 'backend', 'frontend', 'compiler design', 'open source',
      'devlog', 'dev log', 'postmortem', 'build log', 'source code', 'prototype',
      'procedural generation', 'world generation', 'game engine', 'physics engine',
      'shader', 'rendering pipeline', 'under the hood',
      'architecture', 'benchmark', 'debugging', 'git', 'aws', 'cloud',
      'report', 'briefing', 'testimony', 'hearing', 'summit', 'diplomacy',
      'music video', 'concert', 'symphonic', 'remix', 'cover of',
      'sonata', 'quartet', 'jazz', 'classical music'
    ]],
    [W.WEAK, [
      'learn', 'learning', 'understand', 'understanding', 'introduction', 'basics',
      'principles', 'concept', 'concepts', 'method', 'technique', 'demonstration',
      'documentation', 'reference', 'summary', 'overview', 'history', 'ancient',
      'discovery', 'invention', 'innovation', 'data', 'analysis', 'study',
      'interview', 'lecture notes', 'news', 'policy', 'economy', 'market'
    ]]
  ];

  /* --------------------------------------------------- channel reputation */

  var CH_POS = [
    '3blue1brown', 'veritasium', 'kurzgesagt', 'khan academy', 'mit opencourseware',
    'mit ocw', 'stanford', 'harvard', 'yale courses', 'oxford', 'cambridge',
    'crashcourse', 'crash course', 'ted', 'ted-ed', 'teded', 'tedx', 'numberphile',
    'computerphile', 'sixty symbols', 'periodic videos', 'minutephysics',
    'minuteearth', 'vsauce', 'smartereveryday', 'smarter every day', 'steve mould',
    'stand-up maths', 'standupmaths', 'mathologer', 'pbs space time', 'pbs eons',
    'pbs nova', 'nova pbs', 'pbs newshour', 'nasa', 'esa', 'cern', 'nature video',
    'scientific american', 'quanta magazine', 'the royal institution', 'sciencealert',
    'national geographic', 'bbc earth', 'bbc news', 'bbc reel', 'reuters',
    'associated press', 'ap news', 'npr', 'npr music', 'c-span', 'cnbc', 'bloomberg',
    'financial times', 'the economist', 'the wall street journal', 'wsj',
    'the new york times', 'dw news', 'dw documentary', 'france 24', 'al jazeera',
    'sky news', 'abc news', 'cbs news', 'nbc news', 'pbs', 'frontline',
    'real engineering', 'practical engineering', 'engineering explained',
    'the b1m', 'wendover productions', 'polymatter', 'economics explained',
    'johnny harris', 'vox', 'cgp grey', 'kurzgesagt in a nutshell',
    'fireship', 'freecodecamp', 'traversy media', 'the net ninja', 'academind',
    'web dev simplified', 'theprimeagen', 'primeagen', 'computerphile',
    'cs50', 'harvard cs50', 'sentdex', 'corey schafer', 'tech with tim',
    'arjancodes', 'continuous delivery', 'coding train', 'the coding train',
    'statquest', 'josh starmer', 'two minute papers', 'yannic kilcher',
    'andrej karpathy', 'deeplearning ai', 'hugging face', 'lex fridman',
    'huberman lab', 'andrew huberman', 'kurzgesagt', 'be smart', 'scishow',
    'anton petrov', 'sabine hossenfelder', 'cool worlds', 'isaac arthur',
    'the organic chemistry tutor', 'professor leonard', 'patrickjmt', 'blackpenredpen',
    'michel van biezen', 'bozeman science', 'amoeba sisters', 'osmosis',
    'armando hasudungan', 'ninja nerd', 'medcram', 'vevo', 'npr music',
    'gamers nexus', 'linus tech tips', 'hardware unboxed', 'der8auer', 'level1techs',
    'anandtech', 'the verge', 'ars technica', 'ieee spectrum', 'bloomberg originals',
    'the b1m', 'channel 5 with andrew callaghan', 'honest guide'
  ];

  // Substrings that mark a gaming channel even when glued into one word.
  var CH_GAMING = [
    'minecraft', 'fortnite', 'roblox', 'valorant', 'csgo', 'cs2', 'tf2',
    'gaming', 'gamer', 'gameplay', 'speedrun', 'pokemon', 'esports', 'twitch',
    'pubg', 'nintendo', 'playstation', 'xbox'
  ];

  // Organisations whose uploads are, by their nature, informational.
  var INSTITUTION = /\b(university|universidad|college|institute|academy|school of|museum|laborator|observatory|polytechnic|faculty|press|journal)\b/;

  var CH_NEG = [
    'mrbeast', 'mr beast', 'beast reacts', 'beast philanthropy', 'pewdiepie',
    'markiplier', 'jacksepticeye', 'dream', 'georgenotfound', 'sapnap', 'technoblade',
    'tommyinnit', 'ranboo', 'wilbur soot', 'dantdm', 'ssundee', 'preston',
    'unspeakable', 'aphmau', 'lazarbeam', 'muselk', 'fresh', 'sidemen',
    'ksi', 'miniminter', 'zerkaa', 'behzinga', 'vikkstar123', 'w2s', 'tbjzl',
    'kai cenat', 'ishowspeed', 'speed', 'xqc', 'ludwig', 'nickmercs', 'timthetatman',
    'ninja', 'shroud', 'pokimane', 'valkyrae', 'sykkuno', 'disguised toast',
    'jynxzi', 'clix', 'bugha', 'tfue', 'faze', 'nadeshot', 'summit1g',
    'dhar mann', 'sssniperwolf', 'azzyland', 'reaction time', 'infinite',
    'jelly', 'slogo', 'crainer', 'skibidi', 'zhc', 'stokes twins', 'brent rivera',
    'dobre brothers', 'lankybox', 'rebecca zamolo', 'nichlmao', 'juju',
    'smosh', 'try guys', 'good mythical morning', 'rhett and link', 'jackass',
    'love island', 'the bachelor', 'netflix is a joke', 'comedy central',
    'saturday night live', 'snl', 'the tonight show', 'jimmy kimmel', 'ellen',
    'kardashian', 'kylie jenner', 'james charles', 'jeffree star', 'trisha paytas',
    'drama alert', 'keemstar', 'nikocado', 'zach choi', 'hoodville',
    'daily dose of internet', 'failarmy', 'america s funniest', 'tosh',
    'sam and colby', 'colby brock', 'dude perfect', 'yes theory', 'mrwhosetheboss',
    'jubilee', 'cut', 'watcher', 'tlc', 'bravo', 'e! news', 'tmz', 'buzzfeed',
    'summoning salt', 'flamingo', 'gameriot', 'luke thenotable', 'skydoesminecraft',
    'top gear', 'how it should have ended', 'hishe', 'modest pelican', 'ohnepixel',
    'jynxzi', 'pokerev', 'vanossgaming', 'gamesprout', 'red arcade', 'sego plays',
    'top gaming plays', 'juicedspot', 'jelly', 'penguinz0', 'moistcr1tikal'
  ];

  /* --------------------------------------------------- YouTube categories */

  var CAT = {
    'gaming': -3.0,
    'entertainment': -1.6,
    'comedy': -2.6,
    'people & blogs': -1.5,
    'people and blogs': -1.5,
    'sports': -1.2,
    'film & animation': -0.8,
    'pets & animals': -1.0,
    'travel & events': -0.4,
    'autos & vehicles': -0.2,
    'howto & style': 0.4,
    'education': 3.0,
    'science & technology': 3.0,
    'news & politics': 2.6,
    'music': 2.4,
    'nonprofits & activism': 1.0
  };

  /* ------------------------------------------------------------- matching */

  function normalize(s) {
    return (' ' + String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // fiancé → fiance, café → cafe
      .replace(/[‘’“”]/g, "'")
      .replace(/([a-z]{4,})'s\b/g, '$1')  // "Gaming's" → "gaming"; leaves "let's"
      .replace(/'/g, '')
      .replace(/[^a-z0-9$']+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() + ' ');
  }

  /*
   * User edits to the lexicon. `add` holds extra terms, `off` holds built-in
   * terms the user has switched off — both keyed on the same normalised form
   * the lexicon itself uses, so they compare directly against a padded title.
   */
  var custom = { add: [], off: Object.create(null) };
  var TIER = { strong: 0, med: 1, weak: 2 };

  /** Normalise a term the way the lexicon stores them. */
  function termKey(t) { return normalize(t).trim(); }

  function setCustomLexicon(cfg) {
    cfg = cfg || {};
    custom.add = (cfg.add || []).map(function (e) {
      return {
        term: termKey(e.term),
        dir: e.dir === 'pos' ? 'pos' : 'neg',
        strength: TIER[e.strength] === undefined ? 'strong' : e.strength
      };
    }).filter(function (e) { return e.term.length > 1; });

    custom.off = Object.create(null);
    (cfg.off || []).forEach(function (t) {
      var k = termKey(t);
      if (k) custom.off[k] = true;
    });
  }

  function hits(padded, terms) {
    var n = 0, matched = [];
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      if (custom.off[t]) continue;                 // switched off by the user
      if (padded.indexOf(' ' + t + ' ') !== -1) { n++; matched.push(t); }
    }
    return { n: n, matched: matched };
  }

  function channelMatch(channel, list) {
    var c = normalize(channel);
    if (c.trim().length < 2) return null;
    for (var i = 0; i < list.length; i++) {
      if (c.indexOf(' ' + list[i] + ' ') !== -1 || c.indexOf(list[i]) !== -1 && list[i].length >= 5) {
        return list[i];
      }
    }
    return null;
  }

  /* ------------------------------------------------------- presentation */

  // Acronyms that are legitimately capitalised and should not read as shouting.
  var ACRONYMS = /^(NASA|CERN|NATO|IEEE|HTML|JSON|HTTP|HTTPS|REST|GRPC|CUDA|LINUX|MATLAB|IPCC|NOAA|USGS|OPEC|UNESCO|IELTS|MCAT|LSAT|GDPR|SQL|AWS|GPU|CPU|LLM|GPT|API|PBS|NPR|BBC|CNN|MIT|UCLA|USC|NYU|FBI|CIA|WHO|UN|EU|US|UK|AI|ML)$/;

  /**
   * Presentation style. Distraction-optimised titles look different from
   * informational ones long before you read the words: shouting, emoji,
   * first-person stakes, superlatives, trailing ellipsis.
   */
  function styleScore(rawTitle) {
    var t = String(rawTitle || '');
    if (!t) return 0;
    var s = 0;

    // Shouted words (4+ letters, so NBC/API/GPT don't trip it).
    var words = t.split(/\s+/);
    var hasLower = /[a-z]/.test(t);
    if (hasLower) {
      for (var i = 0; i < words.length; i++) {
        var w = words[i].replace(/[^A-Za-z]/g, '');
        if (w.length >= 4 && w === w.toUpperCase() && !ACRONYMS.test(w)) { s -= 0.8; break; }
      }
    }

    // First-person stakes — the grammar of vlogs, challenges and reactions.
    if (/^\s*(i|my|we|me)\b/i.test(t)) s -= 0.4;
    if (/\b(i|my|me|we|our)\b/i.test(t)) s -= 0.6;

    // Second-person address, but only in hook shapes. A bare "you" appears in
    // plenty of ordinary sentences ("how do you defend someone…").
    if (/\byour\b/i.test(t) ||
        /^\s*(you|why you)\b/i.test(t) ||
        /\byou (should|need|must|can'?t|won'?t|will never|are doing|have been)\b/i.test(t) ||
        /\b(ruin|change|save|destroy|shock)s? you\b/i.test(t)) s -= 0.6;

    // Superlatives.
    var superlative = /\b(craziest|greatest|biggest|weirdest|dumbest|funniest|scariest|hardest|worst|best|most\s+insane|wildest|smallest|extreme|infamous)\b/i.test(t);
    if (superlative) s -= 0.7;

    // The vlog signature: a personal stake plus a superlative or a withheld
    // payoff. Either alone is weak; together they are the format itself.
    if (/\b(i|my|me|we|our)\b/i.test(t) && (superlative || /(\.\.\.|…)/.test(t))) s -= 0.7;

    // Trailing ellipsis — the withheld-payoff device. Matches the single
    // "…" glyph as well as three dots; YouTube titles use both.
    if (/(\.\.\.|…)/.test(t)) s -= 0.5;

    // Mathematical-alphanumeric lookalike letters: a spam/engagement-bait tell.
    if (/[\u{1D400}-\u{1D7FF}]/u.test(t)) s -= 2.0;

    // "Asking X what they…" — the street-interview format.
    if (/^\s*(asking|i asked|we asked)\b/i.test(t)) s -= 1.6;

    // Second-person imperative hooks: "Watch BEFORE…", "Stop doing…".
    if (/^\s*(watch|stop|don'?t|never|you|why you)\b/i.test(t)) s -= 0.7;

    return s;
  }

  function clickbaitScore(rawTitle) {
    var t = String(rawTitle || '');
    if (!t) return 0;
    var s = 0;
    var letters = t.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 8) {
      var caps = t.replace(/[^A-Z]/g, '').length / letters.length;
      if (caps > 0.6) s -= 1.8;          // SHOUTING TITLE
      else if (caps > 0.4) s -= W.WEAK;
    }
    if (/[!?]{2,}/.test(t)) s -= W.WEAK;
    // emoji / pictographs
    var emoji = (t.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
    if (emoji >= 2) s -= W.MED;
    else if (emoji === 1) s -= W.FAINT;
    if (/\$\s?\d|\d+[,.]?\d*\s?(k|m|million|thousand)\b/i.test(t) && /\b(challenge|spent|gave|won|buy|bought|vs)\b/i.test(t)) s -= W.MED;
    return s;
  }

  /* ------------------------------------------------------------ the model */

  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  var K = 0.55;
  var BIAS = -0.6;
  var CHANNEL_PRIOR_W = 2.2;
  var THRESHOLD = 0.75;

  /**
   * @param {{title:string, channel:string, category:string, durationSec:number,
   *          isShort:boolean, badges:string}} v
   * @param {{channelPrior:number}} [ctx] Learned evidence about this channel,
   *        in [-1, 1]: +1 = every video seen from it so far was productive.
   * @returns {{block:boolean, p:number, z:number, label:string, reasons:string[]}}
   */
  function classify(v, ctx) {
    v = v || {};
    var rawTitle = v.title || '';
    var padded = normalize(rawTitle + ' ' + (v.badges || ''));
    var chan = v.channel || '';
    var reasons = [];
    var z = 0;

    // 1. Shorts are categorically unproductive.
    if (v.isShort) {
      return { block: true, p: 0.99, z: -6, label: 'short-form', reasons: ['YouTube Short'] };
    }

    // 2. Lexical evidence.
    var negTotal = 0, posStrong = 0, posSoft = 0;
    var negN = [0, 0, 0], posN = [0, 0, 0];
    var negHit = [[], [], []], posHit = [[], [], []];

    for (var i = 0; i < NEG.length; i++) {
      var h = hits(padded, NEG[i][1]);
      negN[i] += h.n; negHit[i] = negHit[i].concat(h.matched);
    }
    for (var j = 0; j < POS.length; j++) {
      var hp = hits(padded, POS[j][1]);
      posN[j] += hp.n; posHit[j] = posHit[j].concat(hp.matched);
    }

    // The user's own terms sit in the same tiers, so they share the
    // diminishing-returns curve rather than stacking on top of it.
    for (var ci = 0; ci < custom.add.length; ci++) {
      var ce = custom.add[ci];
      if (custom.off[ce.term]) continue;
      if (padded.indexOf(' ' + ce.term + ' ') === -1) continue;
      var ti = TIER[ce.strength];
      if (ce.dir === 'neg') { negN[ti]++; negHit[ti].push(ce.term); }
      else { posN[ti]++; posHit[ti].push(ce.term); }
    }

    for (var a = 0; a < 3; a++) {
      if (negN[a]) {
        // diminishing returns: 1st term full weight, extras at 55%
        negTotal += NEG[a][0] * (1 + (negN[a] - 1) * 0.55);
        reasons.push('−' + negHit[a].slice(0, 3).join(', '));
      }
      if (posN[a]) {
        var contrib = POS[a][0] * (1 + (posN[a] - 1) * 0.55);
        if (a === 0) posStrong += contrib; else posSoft += contrib;
        reasons.push('+' + posHit[a].slice(0, 3).join(', '));
      }
    }
    // Gaming: decisive, and it damps the productive lexicon so that a
    // "…explained"/"…tutorial" suffix cannot launder a gaming video.
    var gh = hits(padded, GAMING);
    if (gh.n) {
      negTotal += GAMING_W * (1 + (gh.n - 1) * 0.4);
      posSoft *= GAMING_DAMP;
      reasons.push('−gaming:' + gh.matched.slice(0, 2).join(', '));
    }

    z += posStrong + posSoft - negTotal;

    // 3b. Channel-name signals. A channel called "Water CS2" or "RemyTF2"
    //     announces its genre before a single word of the title is read;
    //     one called "University of California" likewise.
    var chNorm = normalize(chan).replace(/\s+/g, '');
    for (var gi = 0; gi < CH_GAMING.length; gi++) {
      if (chNorm.indexOf(CH_GAMING[gi]) !== -1) {
        z -= 2.2; reasons.push('−gamingchannel:' + CH_GAMING[gi]);
        break;
      }
    }
    if (INSTITUTION.test(normalize(chan))) { z += 3.0; reasons.push('+institution'); }

    // 3. Channel reputation — near-decisive.
    var cn = channelMatch(chan, CH_NEG);
    var cp = channelMatch(chan, CH_POS);
    if (cp && !cn) { z += 4.0; reasons.push('+channel:' + cp); }
    else if (cn && !cp) { z -= 4.0; reasons.push('−channel:' + cn); }
    if (/vevo\s*$/i.test(chan.replace(/\s+/g, ' ').trim())) { z += 3.0; reasons.push('+VEVO'); }

    // 4. Category prior.
    if (v.category) {
      var key = String(v.category).toLowerCase().trim();
      if (Object.prototype.hasOwnProperty.call(CAT, key)) {
        z += CAT[key];
        reasons.push((CAT[key] >= 0 ? '+' : '−') + 'category:' + key);
      }
    }

    // 5. Presentation / clickbait signals.
    var cb = clickbaitScore(rawTitle);
    if (cb) { z += cb; reasons.push('−clickbait'); }

    var st = styleScore(rawTitle);
    if (st) { z += st; reasons.push('−style'); }

    // 6. Duration prior — very short uploads skew entertainment,
    //    long-form skews lecture/documentary but only as a nudge.
    var d = v.durationSec;
    if (typeof d === 'number' && d > 0) {
      if (d < 75) { z -= W.MED; reasons.push('−ultrashort'); }
      else if (d > 1500) { z += W.WEAK; reasons.push('+longform'); }
    }

    // 7. Music-video veto: an unambiguous official release is productive.
    if (/\(official\s+(music\s+)?(video|audio)\)|\[official\s+(music\s+)?video\]/i.test(rawTitle)) {
      z = Math.max(z, 2.5);
      reasons.push('+official release');
    }

    // 8. Learned channel prior. Titles like "ranked push" carry almost no
    //    lexical signal, but a channel that has already produced several
    //    clear-cut distractions is itself the evidence.
    if (ctx && typeof ctx.channelPrior === 'number' && ctx.channelPrior) {
      var cpz = Math.max(-1, Math.min(1, ctx.channelPrior)) * CHANNEL_PRIOR_W;
      z += cpz;
      reasons.push((cpz >= 0 ? '+' : '−') + 'learned channel');
    }

    // Base rate prior: on an attention-optimised platform the unmarked case
    // leans distracting, so neutral evidence should not read as neutral.
    z += BIAS;

    var visible = rawTitle
      .replace(/[\u3164\u2800\u200B-\u200D\uFEFF\u00A0\u115F\u1160\u17B4\u17B5\u3000]/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '');
    if (visible.length < 3) {
      z -= 3.0;
      reasons.push('−empty title');
    }

    var p = sigmoid(-K * z);
    return {
      block: p >= THRESHOLD,
      p: p,
      z: z,
      label: p >= THRESHOLD ? 'unproductive' : (p <= 0.35 ? 'productive' : 'neutral'),
      reasons: reasons
    };
  }

  var api = {
    classify: classify,
    setCustomLexicon: setCustomLexicon,
    termKey: termKey,
    THRESHOLD: THRESHOLD,
    lexicon: { NEG: NEG, POS: POS, GAMING: GAMING, W: W },
    _internals: { normalize: normalize, CAT: CAT, CH_POS: CH_POS, CH_NEG: CH_NEG }
  };

  root.BlindersModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
