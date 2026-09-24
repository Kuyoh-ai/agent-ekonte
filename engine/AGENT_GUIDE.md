# Production guide (read this before writing scene code)

You are animating a video that is rendered offline, frame by frame, in headless Chrome. Nobody watches it render, so
**quality beats speed**: a frame may take up to ~3 s to paint on a normal GPU. Never pick a simpler look, fewer layers
or cheaper motion to save render time. The bar is a finished, lively, hand-crafted piece of animation, not a diagram
that moves. `examples/pdoom/` (a 156 s music video made the same way) shows the level of invention and density
expected: skim `examples/pdoom/STORYBOARD.md` and one chapter such as `examples/pdoom/src/ch/c02_chorus1.js`.

The creative direction lives in the project folder: `brief.json` (what the video is for), `style.md` (look, rendering
kit, palette, characters, motion language) and `storyboard.json` (chapters and shots with times).

## Project layout

```
project.json        format (width, height, fps, duration), audio, captions, look, image assets   (read-only for you)
brief.json          the user's brief                                                             (read-only)
style.md            the style guide Claude wrote and the user approved                            (read-only unless asked)
storyboard.json     chapters → shots (id, start, end, action, visual, transition...)              (read-only: use the studio tools)
captions.json       generated from lyrics / narration                                             (read-only)
drafts/<shot>.svg   approved rough boards: COMPOSITION and STAGING only (see below)
assets/images/      image assets the user uploaded, referred to as @img1, @img2 ... (see "Image assets")
studio.html         the page every frame is painted in: libraries, kits, script tags
lib/                shared code: palette, rigs (characters/props), backgrounds, helpers — written by the lead
chapters/<id>.js    one file per storyboard chapter
out/                renders (check sheets, frames, final video)
```

## The runtime contract (`/engine/runtime.js`)

- Each chapter file is wrapped in an IIFE and registers itself:
  ```js
  (() => {
    function opening(t, lt, dur, info) { /* paint the WHOLE frame */ }
    VIDEO.chapter('intro', 0.0, 8.5, [[0.0, opening, 's01'], [3.2, reveal, 's02']]);
  })();
  ```
  Use the chapter's `id`, `start`, `end` from storyboard.json and pass each shot's `id` as the third element. Shot start
  times are the cut points. `t` is project time, `lt` time since the shot started, `dur` the shot length, `info.p` 0..1.
- **Pure function of t.** Frames render in parallel and out of order: no state carried between frames, no
  `Math.random()`, `Date.now()` or animation loops. Use `hash(i)`, `rng(seed)`, and `rand()` / `jit(a)` (reseeded
  12×/s, so hand-drawn edges "boil" like drawn animation — wanted).
- `VIDEO.W/H/fps/duration` are valid inside shots and in `VIDEO.setup(async () => {...})` (runs once before the first
  frame: build offscreen canvases, load fonts, create renderers), not at script top level.
- `VIDEO.ctx` is the Canvas2D context of the output. Libraries that draw into their own canvas register it once with
  `VIDEO.useSource(canvas)`. `VIDEO.overlay((t, info) => {...})` draws on top of every frame (before captions).
- **Look-dev tests:** `VIDEO.test('cast', (t) => {...})` registers a painter outside the timeline (model sheet, style
  frame, texture test). Render it with `mcp__studio__render_sheet({ times: [0, .3, .6], test: 'cast' })`.
- **Image assets:** `VIDEO.image('img1')` returns the decoded `HTMLImageElement` for @img1 (preloaded before the first
  frame); `VIDEO.assets` lists `{ id, file, name, description, width, height }`.
- Captions (lyrics / narration) are drawn by the runtime when `project.json.captions` is not `none`: keep faces and key
  action out of the bottom ~14% whenever `captions.json` has a line.
- Beat helpers (music projects): `bpOf(t)`, `beatN(t)`, `beatTime(n)`, `pulse(t, k)` (1 on each beat, decays), `pulse2`.
- Maths: `clamp lerp frac seg(t,a,b) ease easeIn easeOut easeInOut backOut elasticOut wob(t,f,ph) kf(t,[[t0,v0],...],e)
  mixCol(hexA,hexB,k) TAU hash rng`.

## Rendering kits (start from these, not from bare primitives)

`style.md` names the kit. The kits give you the texture and finish that make frames look produced.

**painted** — watercolour + ink on paper (p5 + p5.brush), the PDoom look. In studio.html:
`/vendor/p5/lib/p5.min.js`, `/vendor/p5.brush/dist/p5.brush.js`, then `/engine/kits/painted.js`. Wrap every shot:
`[[0, painted(opening), 's01']]` (also `VIDEO.test('cast', painted(fn))`). Inside painted shots:
- `paint(pts, { wash, washOp, fill, fillOp, bleed, tex, border, hatch: { d, a, o, b, c, w }, ink, sw, br, curv })` —
  flat wash for solid character colour, watercolour `fill` (bleed .05–.3, tex .3–.9) for backgrounds, glows and shading,
  `hatch` for dry-brush texture, tapered ink outline (`ink: null` = none).
- `inkLine(pts, sw, colour, brush, curvature)`; brushes `'ink' 'inkfine' 'dry'` + built-ins `'2B' 'HB' 'charcoal'
  'marker' 'spray' 'rotring' 'cpencil' 'pen'`.
- Geometry: `rectPts ellPts rrPts starPts heartPts` (last arg = jitter for boil).
- `push pop translate rotate scale image`, camera `camBegin(cx, cy, zoom, rot)` / `camEnd()`, `shakeXY(t, amt)`.
- `letter(txt, x, y, size, colour, { pop, rot, alpha, stroke })`, `sfx(txt, x, y, size, colour, age, { life })`.
- `flash(k, colour)`, `iris(cx, cy, r)`, `irisShape(pts)`, `brushWipe(p, c1, c2)` (p 0→.5 covers, .5→1 uncovers).
- `PAL` (replace it in lib/shared.js with the style guide palette), `PAINT.paperColor/grain/vignette/letterFont`.
- Characters: flat `wash` + ink outline (sw 0.8–1.6); backgrounds: soft `fill` shapes with little or no outline.

**motion** — Canvas2D motion graphics with depth and texture. In studio.html: `/engine/kits/motion.js` (+ GSAP if
wanted). Call `finish({ grain, vignette, leak })` once in lib/shared.js. Then:
- `cam2d(c, cx, cy, zoom, rot)` / `cam2dEnd(c)`, `shake(t, amt)`, `parallax(dx, dy, depth)`, `haze(col, hazeCol, depth)`.
- `curve(c, pts, { closed, wobble })`, `blobPts(cx, cy, r, n, irregular, seed)`,
  `shape(c, pathFn, { fill, stroke, width, texture, textureKind: 'grain'|'paper'|'halftone'|'hatch', shadow })`.
- `glow(c, x, y, r, colour, alpha)`, `gradientRect(c, x, y, w, h, stops, angle)`, `tex(kind)` (cached pattern canvas).
- `particles(n, t, { life, period, gravity, drag, spawn(i, gen) → { x, y, vx, vy } })` → deterministic particles.
- `popText(c, txt, x, y, size, colour, age, { font, outline, shadow, rot, life })`, `wipe(c, p, colours)`,
  `irisWipe(c, p, x, y, colour)`.

**sketch** — Rough.js (`/vendor/roughjs/bundled/rough.js`) *on top of* the motion kit: seed every Rough call
(`seed: 1 + Math.floor(t * 12)` for boil), and still use colour fills, textures, light and depth. Rough lines alone are
not a finished look.

**anime / vector** — cel-shaded vector characters (`/engine/kits/vector.js` + `/engine/kits/chibi.js`, after motion.js).
Characters are specs of ratios drawn by `chibi(c, SPEC, pose)`; eyes and mouths are morph targets, so expressions
animate instead of snapping. Read `engine/VECTOR_GUIDE.md` (procedure, ranges, sweeps) and copy the sweep tests from
`examples/vector-demo/lib/shared.js`. Backgrounds and finish still come from the motion kit.

**3d** — three.js (`<script type="module">import * as THREE from 'three'`), renderer with `preserveDrawingBuffer: true`
created in `VIDEO.setup`, render inside the shot, `VIDEO.useSource(renderer.domElement)`. Light it properly (key, rim,
ambient), use materials with texture and fog, and add a 2D overlay (motion kit `finish`) for grain.

Also available from `/vendor/`: GSAP (`/vendor/gsap/dist/gsap.min.js`: build paused timelines once, `tl.seek(lt)` in the
shot). Fonts: a Google Fonts `<link>` in studio.html plus `document.fonts.load(...)` in `VIDEO.setup`.

## The quality bar (check every shot against this)

- **Something happens in every shot.** A character acts, something transforms, breaks, chases, falls, grows or is
  revealed. One clear focal action with a strong silhouette, readable instantly.
- **Depth.** At least three layers (background, midground, foreground), each with its own colour value and texture, and
  parallax when the camera moves. No flat single-colour backgrounds with one object on top.
- **Camera.** Every shot has a push, pull, pan, tilt, drift, whip or an on-beat shake. Static cameras are the exception.
- **Acting, not sliding.** Anticipation → action → overshoot → settle; squash and stretch; ease everything (no linear
  moves); secondary motion (ears, hair, cloth, trailing particles, dust on landing); blinks and expression changes that
  animate (squash shut → new face), never snap.
- **Light and atmosphere.** Glows, rim light, cast shadows, haze with distance, colour that shifts with time of day or
  mood, highlights on important objects.
- **Texture and finish.** Paper, grain, brush or halftone texture; boil on hand-drawn edges; a finishing overlay.
- **Rhythm.** Land hits on beats (music projects: `beatTime(n)`, `pulse(t)`), with impact frames: flash, shake, sfx,
  squash.
- **Motivated transitions** that carry motion across the cut, as each shot's `transition` field says.
- **Characters on-model** through a rig in lib/ with pose, expression and emote parameters — never redraw a character
  ad hoc inside a shot.
- **Text** only where the storyboard asks; captions are already handled.

Anti-patterns that fail review: flat vector shapes on an empty background; objects moving at constant speed along
straight lines; the same composition held for the whole shot; everything the same size and value; thin outlines
without fills; one-layer scenes; copying the rough board's simplicity.

## Rough boards are composition only

`drafts/<shot>.svg` fix framing, staging and the key pose. Match them for **where things are and what happens**, never
for rendering: the final frame must look far richer than the board (textures, light, depth, secondary motion).

## Image assets

Assets listed in the project context (and in `VIDEO.assets`) are real images the user wants in the video. When a brief,
comment or message says `@img1`, use that image for what the text describes: look at it first with the Read tool
(`assets/images/...`), then draw it with `VIDEO.ctx.drawImage(VIDEO.image('img1'), ...)` (or as a texture in p5 /
three.js). Respect its aspect ratio; animate it (camera, parallax, cut-out, light) rather than pasting it flat.

## Checking your work (always)

`mcp__studio__render_sheet({ times: [...], cols, width })` renders real frames and returns one image, with ms/frame and
page errors. Check the first and last frame of every shot, a few in between, every ~0.1 s around hits, the transitions
in and out of your chapter and the caption band. Iterate until each shot passes the quality bar above. Then do a
**second pass**: look at the whole chapter again and upgrade the weakest shot.

## Rules for parallel work

- Only edit your own chapter file. If a shared helper is missing, write it privately inside your IIFE and mention it in
  your report. Only the lead agent edits `lib/` and `studio.html`.
- Report progress with `mcp__studio__set_shot_status`: `building` when you start a shot, `built` when it passes your
  visual check (one-line note), `blocked` with the reason if you cannot finish.
