# Blinders — project notes

Archival notes from the build. Kept in the repo so the reasoning survives
alongside the code.

## What it is

A Manifest V3 Chrome extension that predicts which YouTube videos are
unproductive and gets them out of the way. Three behaviours: it blurs
unproductive thumbnails in every feed, hard-blocks their watch pages, and
strips Shorts entirely.

Load it with `chrome://extensions` → Developer mode → Load unpacked.

## Layout

| File | Role |
|---|---|
| `src/model.js` | The classifier. Also runs under Node, which is what makes `test/eval.js` possible. |
| `src/content.js` | Feed scanning, blurring, watch-page shield, Shorts removal |
| `src/probe.js` | MAIN-world probe — reads each navigation's own `playerResponse` |
| `src/channels.js` | Resolves handle / channel id / display name to one comparable key |
| `src/background.js` | Switch, lists, channel memory, badge |
| `popup/` | Toggle, channel allow + block lists, lexicon editor |
| `test/eval.js` | 134 labelled titles → 97.0%, zero false blocks |

## The model is not trained

It is a hand-tuned linear score through a logistic:

```
p(unproductive) = σ(−0.55 · z)      block when p ≥ 0.75
```

The weights were set by hand and tuned against the labelled set. There is no
corpus, no gradient descent, no embeddings. "Predictive model" describes the
shape, not its provenance.

Features summed into `z` (positive = productive):

- a 607-term lexicon, three strength tiers, both directions
- a decisive gaming list (−3.6) that also damps soft positive evidence
- named channel reputation lists (±4.0)
- channel-name shape: gaming substring, academic institution, VEVO suffix
- YouTube category (−3.0 … +3.0) — **watch page only**
- presentation: shouting, emoji, `!!`/`??`, money-challenge framing
- style: first-person stakes, superlatives, ellipsis, second-person hooks
- duration nudges below 75s and above 25 min
- a learned per-channel prior (±2.2)
- a −0.6 base-rate prior

### The learned channel prior

Titles like "ranked push" carry no lexical signal at all. So after two
*confident* verdicts (p ≥ 0.85 or p ≤ 0.25 — never the model's own borderline
calls, which would let the prior bootstrap itself), a channel's track record
becomes a feature for its other uploads. This is the only thing learned at
runtime.

### Decisions worth not re-litigating

- **The 0.75 threshold was chosen by sweeping it**, not picked. It is the last
  point where precision stays at 100%; loosening to 0.70 buys one extra catch
  at the cost of three false blocks.
- **A strong productive term is not damped by a gaming hit**, so "how
  Minecraft's world generation actually works" survives.
- **An official music release is floored at productive** (`(Official Video)`,
  VEVO).
- **The allow and block channel lists are mutually exclusive.** Adding to one
  removes from the other, so the content script never has to guess which wins.
- **Precedence**, most specific first: a video you unblocked yourself →
  Shorts → blocklist → allowlist → the model.

## Four bugs that testing found and reading would not have

1. The Shorts stripper hid entire news shelves that happened to contain one
   Short somewhere inside them.
2. The feed sweep was debounced on `requestAnimationFrame`, which is suspended
   while a tab is hidden — it deadlocked permanently and left pages
   unprotected.
3. Settings were fetched by messaging the service worker. A cold-started MV3
   worker can answer late or not at all, and the failure was **silent**: empty
   lists, nothing blocked. The content script now reads `chrome.storage`
   directly.
4. `ytInitialPlayerResponse` describes only the document's *original* video, so
   navigating inside YouTube judged on title and channel alone — the same thin
   evidence the feed had. Reloading fixed it, which is how the symptom
   presented. The fix reads `/youtubei/v1/get_watch` (not `/player`, which was
   the wrong first guess: 1/5 → 4/4 blocked).

A verdict reached before the real metadata arrives is now marked provisional:
blocking on thin evidence stands, but *letting a video through* on it stays
open and is revisited when the metadata lands.

## The session stopwatch

One session spans a visit, not a page. `src/timer.js` keeps a single
`{ start, last }` in storage and every tab derives its display from `start`, so
opening a video or a second tab never restarts the count and the figure agrees
everywhere. Reading the clock locally each tick also means it keeps ticking
while the MV3 service worker is asleep.

A session ends by going quiet rather than by being stopped: tabs write a
heartbeat while they are visible **or** still playing (audio in a background tab
is still a session), and if nothing has beaten for 15 minutes the next page to
open starts fresh. Several tabs may each believe they opened the session; the
earliest start wins, which converges without any of them co-ordinating.

Two placement details that were not obvious until they broke:

- The drag clamp measures with `getBoundingClientRect()`, not
  `offsetWidth/Height`. Those are rounded, and a real height of 33.5 reported
  as 33 let the bottom edge sit one pixel below the band.
- Clamping is a display constraint, not a preference. The intended position is
  kept separately from the applied one — otherwise a transient tall measurement
  (before YouTube's font loads) would overwrite where the user put it, and the
  widget crept upward a little on every reload.
- A clamp is only as good as the measurement it was computed from, and the
  pill is measured while the page is still settling. A second-by-second check
  of the real rect re-runs the placement if the widget has ended up outside
  the band; without it, enlarging the pill left it two pixels low.

The popup keeps square corners. Rounding them needs a transparent `<html>` and
`<body>` with the background moved to an inner wrapper — a background on
`<body>` propagates to the canvas, which paints across the whole viewport and
ignores any `border-radius`. That renders correctly as a page, but Chrome does
not composite the popup window's own background as transparent, so the corners
came out pale rather than rounded. Reverted.

## Hiding the suggestions column

`#secondary` inside `ytd-watch-flexy` holds the whole rail — the filter chips
and the video list both live under it, so one rule covers them. Hiding it
leaves `#primary` short of the space it was sharing, and because `#primary`
keeps a 1280px max-width it would otherwise sit left-aligned with a gap down
the right-hand side; `margin: 0 auto` centres it instead of stretching it.

The rule is gated on `html.bl-on.bl-norecs`, so switching the extension off
brings the column back along with everything else.

## Known limitations

- **Latin-script only.** `normalize()` reduces titles to `[a-z0-9$']`, so
  Japanese, Korean, Cyrillic and Arabic titles land on the bias term and pass.
  Shorts removal still works; the classifier effectively abstains.
- **On unseen live feeds: roughly 90–95% precision, 65–75% recall.** Lower than
  the 97% labelled figure, which is partly tuned-to-fit. Call it 8/10.
- Channel lists name real creators and will go stale. The only update path is a
  version bump.
- `src/probe.js` wraps `window.fetch` and `XMLHttpRequest` to read replies
  YouTube already fetches. It clones before reading and adds no requests of its
  own, but it is the heaviest touch on the page in the extension — and if
  YouTube renames that endpoint it degrades to the thin read silently.
- DOM selectors track YouTube's renderers, which are A/B tested. There is no
  telemetry to detect breakage.
- **Not Chrome Web Store ready**: needs a privacy policy URL (locally stored
  browsing activity still counts as user data), screenshots, and permission
  justifications. Nothing architectural blocks submission.

## Ideas not taken

- **Feed-side category.** Category is one of the strongest features and feeds
  do not expose it per card — but it *is* in `ytInitialData` for the whole feed
  page, which the existing MAIN-world probe could read. Cheapest remaining
  accuracy win.
- **Learning from the allowlist.** "Wrongly blocked?" whitelists one video and
  teaches the model nothing. Feeding that correction into the channel prior
  would make the strongest available signal actually count.
- CJK / Cyrillic tokenisation, to lift the Latin-script limitation.

## Provenance

Built in a git worktree registered against an unrelated project
(`Canvas Notion Integration`, whose remote was `MayorMilo/Dorm-Manager`). This
repo was created separately and seeded with a clean root commit so none of that
history came along. Verification throughout was done by driving real Chrome over
the DevTools Protocol; those driver scripts were throwaway and were not kept.
`test/eval.js` is the part worth keeping.
