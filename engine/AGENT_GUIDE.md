# Production guide (read this before writing scene code)

You are painting a video that is rendered offline, frame by frame, in headless Chrome. The creative direction lives in
the project folder: `brief.json` (what the video is for), `style.md` (look and feel), and `storyboard.json` (chapters and
shots with times). Your job is to turn approved shots into code that looks good in every frame.

## Project layout

```
project.json        format (width, height, fps, duration), audio, captions style      (read-only for you)
brief.json          the user's brief                                                 (read-only)
style.md            the style guide Claude wrote and the user approved                (read-only unless asked)
storyboard.json     chapters → shots (id, start, end, action, visual, transition...)  (read-only: use the studio tools)
captions.json       generated from lyrics / narration                                 (read-only)
drafts/<shot>.svg   the approved rough board for each shot: match its composition
studio.html         the page every frame is painted in: libraries + script tags
lib/shared.js       palette, characters, helpers shared by all chapters
chapters/<id>.js    one file per storyboard chapter
assets/             audio, images and fonts the user provided
out/                renders (check sheets, frames, final video)
```

## The runtime contract (`/engine/runtime.js`)

- Each chapter file is wrapped in an IIFE and registers itself:
  ```js
  (() => {
    function opening(t, lt, dur, info) { const c = VIDEO.ctx; /* paint the WHOLE frame */ }
    function reveal(t, lt, dur, info) { ... }
    VIDEO.chapter('intro', 0.0, 8.5, [[0.0, opening, 's01'], [3.2, reveal, 's02']]);
  })();
  ```
  Use the chapter's `id`, `start` and `end` from storyboard.json and pass each shot's `id` as the third element, so the
  studio can map frames to shots. Shot start times are the cut points. `t` is project time, `lt` the time since the
  shot started, `dur` the shot length, `info.p` the 0..1 progress through the shot.
- **Pure function of t.** Frames render in parallel and out of order. No state that carries between frames, no
  `Math.random()`, no `Date.now()`, no animation loops. Use `hash(i)` for stable per-object randomness, `rng(seed)` for a
  seeded generator, and `rand()` / `jit(a)` for jitter that is reseeded 12×/s (hand-drawn "boil").
- `VIDEO.W`, `VIDEO.H`, `VIDEO.fps`, `VIDEO.duration` hold the project format. Read them inside shot functions or in
  `VIDEO.setup()`, not at script top level (they are set after `project.json` loads).
- `VIDEO.setup(async () => {...})` runs once before the first frame: build offscreen canvases, load images
  (`await img.decode()`), create a p5 instance or a three.js renderer here.
- `VIDEO.ctx` is a Canvas2D context on the output canvas. Canvas2D is the default and is enough for most flat, vector,
  motion-graphics and typographic styles.
- Other libraries draw into their own canvas; register it once with `VIDEO.useSource(canvas)` and the runtime copies it
  into the output after each shot. `VIDEO.overlay((t, info) => {...})` draws on top of everything (vignette, grain,
  letterbox), before captions.
- Captions (lyrics or narration) are drawn by the runtime when `project.json.captions` is not `none`. Keep faces and key
  action out of the bottom ~14% of the frame whenever `captions.json` has a line at that time.
- Beat helpers are active when the project has music: `bpOf(t)` beat position, `beatN(t)`, `beatTime(n)` (song time of
  beat n), `pulse(t, k)` (1 on each beat, decays), `pulse2` (eighths). Land cuts and hits on beats.
- Maths: `clamp lerp frac seg(t,a,b) ease easeIn easeOut easeInOut backOut elasticOut wob(t,f,ph) kf(t,[[t0,v0],...],e)
  mixCol(hexA,hexB,k) TAU`.

## Libraries

Load only what the project needs, in `studio.html`, from the `/vendor/` mount (no CDNs: renders may run offline):

| library | tag | notes |
|---|---|---|
| p5.js 2 | `<script src="/vendor/p5/lib/p5.min.js"></script>` | use instance mode in `VIDEO.setup`, `noLoop()`, draw inside the shot, then `VIDEO.useSource(p.canvas)` |
| p5.brush | `<script src="/vendor/p5.brush/dist/p5.brush.js"></script>` | watercolour/ink (see `examples/pdoom` for a full production that used it) |
| three.js | `<script type="module">import * as THREE from 'three'; ...</script>` | import map is already in studio.html; `preserveDrawingBuffer: true`, render inside the shot, `VIDEO.useSource(renderer.domElement)` |
| GSAP | `<script src="/vendor/gsap/dist/gsap.min.js"></script>` | build paused timelines once, then `tl.seek(lt)` inside the shot |
| Rough.js | `<script src="/vendor/roughjs/bundled/rough.js"></script>` | sketchy shapes on `VIDEO.canvas`; seed every call so frames are stable |

Fonts: a Google Fonts `<link>` in studio.html works; the renderer waits for `document.fonts.ready`. Use
`document.fonts.load('700 80px "Font Name"')` in `VIDEO.setup` for faces that appear only on canvas.

## Checking your work (always do this)

Run from the project folder (paths in the command are relative to it). The renderer uses the real browser:

```
node ../../engine/render.mjs --project=. --sheet=12.0,12.6,13.3,14.0,14.7,15.4 --cols=3 --w=640 --out=out/check/c02_a.jpg
node ../../engine/render.mjs --project=. --stills=12.4 --out=out/check/c02_full
```

Then open the image with the Read tool and look carefully. Check the first and last frame of every shot and a few in
between, consecutive times around each hit (every ~0.1 s), transitions into and out of your chapter, and the caption band.
The sheet prints ms per frame: aim for ≤ 1.5 s per frame; never exceed ~4 s. Iterate until each shot is readable,
on-style, lively and matches its approved draft.

## Quality bar

- One clear focal action per shot, with a strong silhouette. Something happens in every shot.
- Every shot has camera or subject motion. Use anticipation, overshoot and easing, never linear pops.
- Follow `style.md` for palette, type and texture. Contrast between subject and background must be clear.
- Make transitions motivated: the action or camera carries across the cut, as the storyboard's `transition` field says.
- Keep text on screen to what the storyboard asks for. Captions are already handled by the runtime.

## Rules for parallel work

- Only edit your own chapter file. If a shared helper is missing, write it privately inside your IIFE and mention it in
  your final report. Only the lead agent edits `lib/shared.js` and `studio.html`.
- Report progress with the studio tools: `set_shot_status` → `building` when you start a shot, `built` when it passes
  your visual check (include a one-line note), `blocked` with the reason if you cannot finish.
