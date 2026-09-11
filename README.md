# Blinders — Focus for YouTube

A Chrome extension (Manifest V3) that predicts which YouTube videos are
unproductive and gets them out of your way: blurred thumbnails, a hard block
on the watch page, and no Shorts.

**Productive** — academic explainers, documentaries, reputable news, music
videos, technical tutorials.
**Unproductive** — gaming, commentary/drama, reality & dating, memes,
laugh-out-loud comedy, challenge/stunt vlogs, Shorts.

## Install (developer mode)

1. Open `chrome://extensions/`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Open `youtube.com`

Toggle it on and off from the toolbar icon.

## What it does

**1. Blurs unproductive thumbnails.** Every card in every feed — home, search,
sidebar, subscriptions — is scored. Ones that fail get a heavy blur, a dimmed
title, an inert link, and a small "Blinders" chip. Re-evaluated continuously,
because YouTube recycles card elements as you scroll.

**2. Blocks the watch page — on the same evidence, however you got there.**
A feed card only exposes a title, a channel and a duration. The watch page also
has the video's YouTube category, which is one of the strongest features the
model has. So the watch page must never settle for the feed's thinner read.

Two things make that hold. First, `src/probe.js` reads the metadata for
*this* video on every navigation: a fresh document exposes it as
`ytInitialPlayerResponse`, but navigating inside YouTube leaves that global
describing the PREVIOUS video, so the probe also watches the
`/youtubei/v1/get_watch` and `/youtubei/v1/player` calls each navigation makes
and reads the same `playerResponse` out of the reply. Second, a verdict
reached before that arrives is marked provisional: blocking on thin evidence
stands, but *letting a video through* on it stays open, and is revisited the
moment the real metadata lands.

The net effect is that a video the feed didn't blur is still judged on full
evidence when you open it — which is what reloading the page used to be
needed for.

Works whether you arrive by click or by pasting a URL. The player is hidden and every `play` event is intercepted at the capture
phase from `document_start`, so nothing is seen or heard before the verdict —
in testing, blocked videos sit at `currentTime === 0`, muted. The block screen
shows the confidence and offers *Go back*, *YouTube home*, and a *wrongly
blocked?* link that whitelists the video and reloads.

**3. Removes Shorts.** The sidebar entry, the mini-guide entry, the "Shorts"
filter chip, Shorts shelves, and individual Shorts in the grid. `/shorts/`
URLs are blocked outright.

**4. Lets you overrule it, in both directions.** "Unproductive" is a judgement
call, so you get the final say:

- *wrongly blocked?* on the block screen — whitelists that one video.
- **Always allow** a channel — it is never scored again, anywhere.
- **Never allow** a channel — every video from it is blurred and blocked
  outright, whatever the model thinks. The block screen says so plainly
  instead of quoting a confidence it didn't compute.

Both lists live under **Settings** in the popup: paste a channel link to add,
`×` to remove. They are mutually exclusive — naming a channel on one list takes
it off the other, so the content script never has to guess which wins.

Channels are matched by handle, channel id, or display name, so
`youtube.com/@veritasium`, `@veritasium`, a `/channel/UC…` link, or just
`Veritasium` all work; a non-YouTube URL is rejected. Changes apply to open
tabs immediately — no reload. Allowing a channel does not bring its Shorts
back.

**5. Lets you edit the lexicon itself.** Under **Settings → Lexicon** (collapsed
by default) is a search box over all 607 built-in terms. Searching is the
point: before you add anything, you can see whether the model already covers
it, in which direction, and at what strength — so you don't add a redundant
term that quietly doubles an existing weight.

- Type a term to see every built-in and custom term containing it.
- `×` on a built-in **switches it off** — it stays visible, struck through,
  with `↺` to restore. Useful when a term misfires for you specifically
  (switch off `laugh` if you study comedy, `minecraft` if you write about
  game engines).
- `×` on one of your own terms deletes it.
- If nothing matches exactly, an **Add** row appears: pick a direction
  (distracting / productive) and a strength (strong / med / weak), and the
  term joins that tier — sharing its diminishing-returns curve rather than
  stacking on top of it.

Terms are normalised the way the lexicon stores them, so `Minecraft` and
`minecraft` are the same entry, and multi-word phrases work. Edits apply to
open tabs immediately.

Precedence, most specific first: a video you unblocked yourself → Shorts →
your blocklist → your allowlist → the model (with your lexicon edits applied).

**6. Counts how long you've been here.** A stopwatch starts the moment you
open YouTube and keeps running across tabs, navigation and videos — every tab
shows the same figure, because the elapsed time is derived from one shared
start timestamp rather than from when a page happened to load.

It sits in a glass pill at the top of the page and can be dragged, but only
within the **top 100 pixels**: horizontal movement is free, vertical is clamped
so the whole pill stays inside that band and never drifts down over the video.
Where you put it is remembered.

A session ends by going quiet rather than by being stopped. Tabs check in while
they are visible or playing; if nothing has checked in for 15 minutes, the next
page you open starts a fresh count. Leaving a tab open in the background with
the video paused therefore does not keep the clock running for ever.

## The model

`src/model.js` — a linear scoring model, on-device, no network, ~0.05 ms per
video. Features, summed into `z` (positive = productive) and squashed:

| Feature | Weight |
|---|---|
| Lexicon hits (three strength tiers, both directions; user-editable) | ±0.7 … ±2.2 |
| Gaming terms — decisive, and they damp soft positive evidence | −3.6 |
| Channel reputation lists | ±4.0 |
| Channel name shape (gaming substring / academic institution) | ±2.2 … ±3.0 |
| YouTube category (watch page only) | −3.0 … +3.0 |
| Learned per-channel prior | ±2.2 |
| Presentation: shouting, emoji, `!!`/`??`, money-challenge framing | −0.35 … −1.8 |
| Style: first-person stakes, superlatives, ellipsis, second-person hooks | −0.4 … −1.6 |
| Duration (very short / long-form) | ∓0.7 … 1.3 |
| Base-rate prior | −0.6 |

`p(unproductive) = σ(−0.55·z)`, block at `p ≥ 0.75`. That threshold was chosen
by sweeping it against the labelled set — it is the point where precision is
still 100% (see below); loosening to 0.70 buys one extra catch at the cost of
three false blocks.

**Learned channel prior.** Titles like "ranked push" carry no lexical signal at
all. So Blinders remembers what it has already concluded about each channel:
after two *confident* judgements (p ≥ 0.85 or p ≤ 0.25 — never its own
borderline calls, which would let the prior bootstrap itself), the channel's
track record becomes a feature for its other uploads. This is what catches the
short, generic gaming titles that no lexicon can reach.

Two escape hatches keep precision high: a strong productive term is *not*
damped by a gaming hit, so "how Minecraft's world generation actually works"
survives; and an official music release (`(Official Video)`, VEVO) is floored
at productive.

## Evaluation

`node test/eval.js` — 134 labelled titles: 73 synthetic, plus 61 captured
verbatim from live youtube.com feeds.

```
synthetic       n=73   acc 100.0%   prec 100.0%   rec 100.0%
live feed A     n=25   acc 100.0%   prec 100.0%   rec 100.0%
live feed B     n=36   acc  88.9%   prec 100.0%   rec  81.8%
overall         97.0%  (4 errors / 134)
```

All four remaining errors are misses, not false blocks, and all sit just under
threshold (p = 0.58–0.74) on genuinely ambiguous titles.

On *unseen* live feeds the honest numbers are lower than the labelled set:
precision holds around 90–95%, recall lands around 65–75%. The gap is
title-only classification — a travel vlog called "3 days in shenzhen" is not
separable from a documentary by its words alone. The channel prior closes much
of that gap as you browse.

## Files

```
manifest.json        MV3 manifest
src/model.js         the classifier (also runs under Node for tests)
src/channels.js      channel identity: handle / id / display name → one key
src/content.js       feed scanning, blurring, watch-page shield, Shorts removal
src/content.css      blur, veil, block screen, Shorts hiding
src/probe.js         MAIN-world probe: reads each navigation's playerResponse
src/timer.js         session stopwatch: shared clock, drag clamped to the top
src/background.js    switch, allowlists, channel memory, daily count, badge
popup/               the toggle and settings
test/eval.js         accuracy harness
```

## Notes

- Only permission is `storage`, plus host access to `youtube.com`. No network calls.
- Everything is local — nothing about your viewing leaves the browser.
- The daily block count counts each video once per day, and resets at midnight.
- Settings are stored per-browser (`chrome.storage.local`), not synced across
  devices. The content script reads them from storage directly rather than
  asking the service worker, because a cold-started MV3 worker can answer late
  or not at all — and the failure mode there is silent.
- The lexicon is English-only: `normalize()` reduces titles to `[a-z0-9$']`, so
  a Japanese, Korean, Cyrillic or Arabic title carries almost no signal and will
  pass. On non-English YouTube, Shorts removal still works but the classifier
  effectively abstains.
