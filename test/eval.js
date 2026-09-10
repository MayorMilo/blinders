/*
 * Blinders — offline accuracy harness.
 *   node test/eval.js
 * Labels: 1 = should be blocked (unproductive), 0 = should pass (productive).
 * Titles are drawn from real YouTube listings across both classes.
 */
const M = require('../src/model.js');

const CASES = [
  // ---------------------------- productive: academic / explainer
  ['But what is the Fourier Transform? A visual introduction', '3Blue1Brown', 0],
  ['The Map of Mathematics', 'Domain of Science', 0],
  ['Quantum Entanglement explained simply', 'Veritasium', 0],
  ['Introduction to Algorithms — Lecture 1', 'MIT OpenCourseWare', 0],
  ['Organic Chemistry Nomenclature Practice Problems', 'The Organic Chemistry Tutor', 0],
  ['How does the immune system actually work?', 'Kurzgesagt – In a Nutshell', 0],
  ['Photosynthesis: Light Reactions', 'Amoeba Sisters', 0],
  ['Linear Algebra: Eigenvalues and Eigenvectors', 'Professor Leonard', 0],
  ['The Central Limit Theorem, clearly explained', 'StatQuest with Josh Starmer', 0],
  ['General Relativity in 12 minutes', 'PBS Space Time', 0],
  ['Why do we sleep? The neuroscience of rest', 'Huberman Lab', 0],
  ['Understanding Inflation and Monetary Policy', 'Economics Explained', 0],

  // ---------------------------- productive: documentary
  ['The Rise and Fall of the Roman Republic — Full Documentary', 'Kings and Generals', 0],
  ['Chernobyl: The Untold Story', 'DW Documentary', 0],
  ['Inside the World’s Largest Particle Accelerator', 'CERN', 0],
  ['The History of the Silk Road', 'Timeline - World History Documentaries', 0],
  ['How Antarctica Is Changing — a documentary', 'BBC Earth', 0],

  // ---------------------------- productive: news
  ['Breaking news: Federal Reserve holds rates steady', 'Bloomberg', 0],
  ['Full press conference from the White House', 'Reuters', 0],
  ['Election results and analysis', 'PBS NewsHour', 0],
  ['Ukraine: latest developments and geopolitics', 'DW News', 0],
  ['Senate hearing on AI regulation — full testimony', 'C-SPAN', 0],

  // ---------------------------- productive: music
  ['Taylor Swift - Blank Space (Official Music Video)', 'TaylorSwiftVEVO', 0],
  ['Kendrick Lamar - HUMBLE. (Official Video)', 'KendrickLamarVEVO', 0],
  ['Billie Eilish: Tiny Desk Concert', 'NPR Music', 0],
  ['Beethoven — Symphony No. 5 (Full)', 'Berlin Philharmonic', 0],
  ['Fred again.. | Boiler Room London', 'Boiler Room', 0],
  ['SZA - Snooze (Official Audio)', 'SZAVEVO', 0],

  // ---------------------------- productive: technical
  ['React in 100 Seconds', 'Fireship', 0],
  ['Build a REST API with Node.js and Postgres', 'Traversy Media', 0],
  ['Docker Tutorial for Beginners — Full Course', 'freeCodeCamp.org', 0],
  ['System Design Interview: Design a URL Shortener', 'ByteByteGo', 0],
  ['Let’s build GPT: from scratch, in code', 'Andrej Karpathy', 0],
  ['Understanding Kubernetes Networking', 'TechWorld with Nana', 0],
  ['Git branching explained step by step', 'The Net Ninja', 0],

  // ---------------------------- unproductive: gaming
  ['I Survived 100 Days in Hardcore Minecraft', 'Luke TheNotable', 1],
  ['INSANE Fortnite Victory Royale Gameplay!!', 'Clix', 1],
  ['Ranking EVERY Valorant Agent (Tier List)', 'Some Gamer', 1],
  ['Minecraft But Everything Is Random...', 'Dream', 1],
  ['I Beat Elden Ring Without Taking Damage', 'Speedrun Central', 1],
  ['GTA 6 Trailer Reaction — I CANNOT BELIEVE THIS', 'GameRiot', 1],
  ['Roblox Doors but I cheat', 'Flamingo', 1],
  ['New World Record Speedrun Explained', 'Summoning Salt', 1],

  // ---------------------------- unproductive: commentary / drama
  ['The Truth About This YouTuber... (exposed)', 'DramaAlert', 1],
  ['My Apology Video', 'Some Influencer', 1],
  ['Reacting to My Old Cringe Videos', 'Reaction Time', 1],
  ['THE DRAMA KEEPS GETTING WORSE — full commentary', 'Commentary Channel', 1],
  ['Ranking every celebrity feud of 2024', 'Gossip Weekly', 1],

  // ---------------------------- unproductive: reality / dating
  ['20 Girls vs 1 Rapper — Speed Dating', 'Jubilee', 1],
  ['Love Island: the most dramatic recoupling ever', 'Love Island', 1],
  ['I Went On A Blind Date With My Ex', 'Random Vlogger', 1],
  ['She Chose HIM?! Dating Show Finale', 'RealityTV Clips', 1],
  ['90 Day Fiancé: worst moments', 'TLC', 1],

  // ---------------------------- unproductive: memes / lol comedy
  ['TRY NOT TO LAUGH CHALLENGE 😂😂', 'Smosh', 1],
  ['Best Memes of the Month Compilation', 'Meme Lord', 1],
  ['Ultimate Fails Compilation 2024', 'FailArmy', 1],
  ['I Pranked My Roommate For 24 Hours', 'Stokes Twins', 1],
  ['TikTok Brainrot Compilation (cursed)', 'Clip Farm', 1],
  ['Funniest Moments That Made Me Cry Laughing', 'Daily Dose of Internet', 1],

  // ---------------------------- unproductive: challenge / stunt vlog
  ['$1,000,000 Challenge — Last To Leave Wins', 'MrBeast', 1],
  ['Day In My Life As A College Student ✨ vlog', 'Lifestyle Girl', 1],
  ['MUKBANG: Eating Only Red Food For 24 Hours', 'Nikocado', 1],
  ['GRWM + Storytime: my worst date ever', 'Beauty Vlogger', 1],
  ['I Spent 50 Hours In A Haunted House', 'Sam and Colby', 1],
  ['ASMR Whisper Ramble to Help You Sleep', 'ASMR Channel', 1],

  // ---------------------------- adversarial / near-boundary
  ['Coding Challenge #145: Fourier Transform Drawing', 'The Coding Train', 0],
  ['The Science of Video Game Addiction', 'SciShow Psych', 0],
  ['A History of Comedy: Documentary', 'BBC Reel', 0],
  ['Game Theory explained with examples', 'Khan Academy', 0],
  ['How Minecraft’s world generation actually works', 'Alan Zucconi', 0],
  ['Reaction Kinetics — Chemistry Lecture 4', 'Stanford', 0],
  ['I built a compiler in 100 hours', 'Fireship', 0],
  ['Music Theory: why this chord progression works', 'Adam Neely', 0]
];


/*
 * Titles captured verbatim from a live youtube.com feed on 2026-09-09.
 * Kept separate from the synthetic set: this is the honest out-of-sample
 * check, since the synthetic cases were written alongside the lexicon.
 */
const REAL = [
  ['NBC Nightly News with Tom Llamas Full Episode - Sept. 8', 'NBC News', 0],
  ['Mix - Cyberpunk: Edgerunners — Ending Theme | Let You Down by Dawid Podsiadło | Netflix', '', 0],
  ['I Made a $500 AI Commercial in 20 Minutes With Seedance 2.5', 'Sanji Nai-Chien', 0],
  ['US Says It Destroyed Iran Tankers After Navy Ship Targeted', 'Bloomberg Television', 0],
  ['Trump’s trade war with Canada looms over key congressional races', 'PBS NewsHour', 0],
  ['This Is What Running a $2B AI Startup Looks Like', 'Tanay Kothari', 0],
  ['coding music for people who lock in for hours', 'Productivity FM', 0],
  ['Mamdani releases undisclosed 9/11 files showing New Yorkers were misled', 'The Independent', 0],
  ['PICOFarm - Making a farming sim in scratch (game jam devlog)', 'MuuMuu', 0],
  ['Claude + Blender + Seedance 2.5 = Insane Websites', 'Kyle Skelly', 0],

  ['ohnePixel tries to get his Valorant rank (ft. jL & furiousss)', 'dogsushi enjoyer', 1],
  ['Trying to Not Get A Single Laugh', 'Aaron Westberry', 1],
  ['How I Got My Dream Car 1 Year Into Day Trading', 'Evan Krutchik', 1],
  ['Chinese Internet Cafes Offer THIS Now??', 'Ina Yu', 1],
  ['Jon on Trump\'s Meme Assault on Canada & the Alternate Reality', 'The Daily Show', 1],
  ['Destroying Sweats and Cheaters in Doubles', 'Viseq', 1],
  ['The Craziest Trade Offer I Ever Got...', 'ohnepixel raw', 1],
  ['All My Employees Are Single--So I threw the Biggest Speed Dating Event', 'Cluely', 1],
  ['The greatest game I never played', 'Modest Pelican', 1],
  ['30 Singles Blind Date in Total Darkness | Love in the Dark', 'Cut', 1],
  ['I BOUGHT A NON RUNNING BUGATTI VEYRON', 'Mat Armstrong', 1],
  ['1 Million Players Doomscrolling In-Game', 'Avioolí', 1],
  ['I made a successful game... It ruined my life', 'AIA', 1],
  ['Asking USC Grads What Their Starting Salary Is! (2026)', 'Charlie Chang', 1],
  ['Watch BEFORE the Apple Event Today.', 'Meet Kevin', 1]
];


/* A second live capture (49-card home feed, same day, scrolled). */
const REAL2 = [
  ['Mamdani releases undisclosed 9/11 files showing New Yorkers were misled', 'The Independent', 0],
  ['nothing, except everything.', 'Wesley Wang', 0],
  ['Claude Fable 5.1 is lowkey NUTS.', 'tef', 0],
  ['NBC Nightly News with Tom Llamas Full Episode - Sept. 8', 'NBC News', 0],
  ['My answer to "how do you defend someone you think is guilty"', 'Dominic D’Souza Barris', 0],
  ['US Says It Destroyed Iran Tankers After Navy Ship Targeted', 'Bloomberg Television', 0],
  ['CS50 Lecture by Mark Zuckerberg - 7 December 2005', 'CS50', 0],
  ['PICOFarm - Making a farming sim in scratch (game jam devlog)', 'MuuMuu', 0],
  ['Did OpenAI actually build AGI? GPT-6 Astra first look', 'Fireship', 0],
  ['14. What Motivates Us: Sex', 'YaleCourses', 0],
  ['Robots Just Had Their GPT-3 Moment', 'bycloud', 0],
  ['Life Lessons From Big Tech Workers Who Got Laid Off', '', 0],
  ['Nico Rosberg Retires From F1: Reaction', 'FORMULA 1', 0],
  ['UC admissions REACTS to TikTok application advice', 'University of California', 0],

  ['The most controversial mission of all time', 'Modest Pelican', 1],
  ['How 1 Person Solved A $1,000,000 Puzzle!', 'MrBeast 2', 1],
  ['The GeoGuessr World Cup Is INSANE', 'ohnepixel raw', 1],
  ['How to Get Better at BloxGolf (Tips & Tricks) #roblox #golf', 'BloxGolfing', 1],
  ['Video recording showing the live reaction by Malone lam receiving', 'Told', 1],
  ['Ivy League vs Community College: Which Education Is Better?', 'Jubilee', 1],
  ['Opening The Rarest Elite Pokemon Box Was Actually Worth It', 'PokeRev', 1],
  ['how you play games is how you do everything.', 'doozy', 1],
  ['The Craziest Trade Offer I Ever Got...', 'ohnepixel raw', 1],
  ['50 Girls Rank 5 Guys by Attractiveness', 'Jubilee', 1],
  ['How Spider-Man Brand New Day Should Have Ended', 'How It Should Have Ended', 1],
  ['Jon on Trump’s Meme Assault on Canada & the Alternate Reality', 'The Daily Show', 1],
  ['🔴SPIRIT vs MOUZ [GRAND FINAL] BLAST PORTO 2026🔴', 'ohnepixel', 1],
  ['I Ran DLSS 5 SIX TIMES on TF2', 'RemyTF2', 1],
  ['I Ranked the Hardest Games of All Time', 'Ludwig', 1],
  ['𝐘𝐨𝐮 𝐚𝐫𝐞 𝐛𝐮𝐢𝐥𝐝𝐢𝐧𝐠 𝐮𝐩 𝐲𝐨𝐮𝐫 𝐩𝐫𝐨𝐣𝐞𝐜𝐭', '𝐌𝐔𝐍𝐃𝐈 𝐎𝐏𝐔𝐒', 1],
  ['Guess The Crypto Millionaire (ft. Brez)', '', 1],
  ['This Is A New 960hp V8 British Muscle Car! | 4K', 'Top Gear', 1],
  ['NEW R6 PACKS ARE HERE (HUGE OPENING)', 'Jynxzi Live', 1],
  ['Who Owns North Korea’s Steam Account?', 'Water CS2', 1],
  ['I rowed 250 miles in 14 days.', 'Tom Lynch', 1],
  ['5 years OFF social media [update]', 'Athena Isabella', 1]
];

function score(set, name) {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  const errs = [];
  for (const [title, channel, label] of set) {
    const r = M.classify({ title, channel });
    const pred = r.block ? 1 : 0;
    if (pred && label) tp++;
    else if (!pred && !label) tn++;
    else if (pred && !label) { fp++; errs.push(['FALSE BLOCK', title, channel, r.p, r.reasons.join(' ')]); }
    else { fn++; errs.push(['MISSED     ', title, channel, r.p, r.reasons.join(' ')]); }
  }
  const n = set.length;
  const prec = tp / (tp + fp || 1), rec = tp / (tp + fn || 1);
  console.log(`\n  ── ${name} ──  n=${n}  acc ${((tp+tn)/n*100).toFixed(1)}%  ` +
              `prec ${(prec*100).toFixed(1)}%  rec ${(rec*100).toFixed(1)}%  ` +
              `F1 ${(2*prec*rec/((prec+rec)||1)*100).toFixed(1)}%   [FP ${fp} / FN ${fn}]`);
  for (const [k, t, c, p, why] of errs) {
    console.log(`   ${k} p=${p.toFixed(2)}  ${t.slice(0,52).padEnd(52)} ${c.slice(0,18).padEnd(18)} ${why.slice(0,46)}`);
  }
  return { fp, fn, n };
}

let tp = 0, tn = 0, fp = 0, fn = 0;
const errors = [];

for (const [title, channel, label] of CASES) {
  const r = M.classify({ title, channel });
  const pred = r.block ? 1 : 0;
  if (pred === 1 && label === 1) tp++;
  else if (pred === 0 && label === 0) tn++;
  else if (pred === 1 && label === 0) { fp++; errors.push(['FALSE BLOCK', title, channel, r.p]); }
  else { fn++; errors.push(['MISSED', title, channel, r.p]); }
}

const a = score(CASES, 'synthetic');
const b = score(REAL, 'live feed A');
const d = score(REAL2, 'live feed B');
const totalErr = a.fp + a.fn + b.fp + b.fn + d.fp + d.fn;
const totalN = a.n + b.n + d.n;
console.log(`\n  overall  ${(((totalN - totalErr) / totalN) * 100).toFixed(1)}%   (${totalErr} errors / ${totalN})\n`);
process.exit(totalErr > totalN * 0.1 ? 1 : 0);
