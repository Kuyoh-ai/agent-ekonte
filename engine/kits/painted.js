// painted.js: watercolour + ink kit (ported from examples/pdoom/src/core.js) on top of the frame runtime.
// Load after p5 and p5.brush:
//   <script src="/vendor/p5/lib/p5.min.js"></script>
//   <script src="/vendor/p5.brush/dist/p5.brush.js"></script>
//   <script src="/engine/kits/painted.js"></script>
// Shots that paint with it are wrapped with painted():
//   VIDEO.chapter('intro', 0, 6, [[0, painted(opening), 's01'], ...]);
//   function opening(t, lt, dur, info) { paint(ellPts(960, 540, 300, 200, 28, 6), { wash: PAL.clay, ink: PAL.ink, sw: 1.4 }); }
// Inside a painted shot, the p5 transform helpers (push, pop, translate, rotate, scale, resetMatrix, image) work on the
// painted canvas, in a 0..W × 0..H space with y down. Every frame starts on a watercolour paper texture; lettering
// (letter / sfx) is composited on top, then a paper grain and vignette are multiplied over everything.
(() => {
  'use strict';
  let P = null, pending = null, paperG = null, grainC = null;
  const LETTERS = [];

  // Default palette (the PDoom one). Projects usually replace it: Object.assign(PAL, { ... }).
  const PAL = window.PAL || {};
  Object.assign(PAL, Object.assign({
    paper: '#F3EBDC', ink: '#2B2233', clay: '#D97757', clayDk: '#A84D33', clayLt: '#F2A283',
    night: '#1F2550', indigo: '#2F3C7A', rose: '#E27A92', ochre: '#E8AA38', sap: '#6E9F58',
    teal: '#3A9C98', violet: '#7B5CA8', cream: '#FFF5E2', sky: '#8EC3E6',
  }, PAL));
  const PAINT = { paperColor: null, grain: .55, vignette: .35, boil: 12, brushScale: null, get p() { return P; } };

  // ---------- geometry (jitter is reseeded per boil frame, so edges "boil" like hand-drawn animation) ----------
  const rectPts = (x, y, w, h, j = 0) => [[x + jit(j), y + jit(j)], [x + w / 2 + jit(j), y + jit(j) * .5], [x + w + jit(j), y + jit(j)],
    [x + w + jit(j) * .5, y + h / 2], [x + w + jit(j), y + h + jit(j)], [x + w / 2 + jit(j), y + h + jit(j) * .5], [x + jit(j), y + h + jit(j)], [x + jit(j) * .5, y + h / 2]];
  const ellPts = (cx, cy, rx, ry, n = 28, j = 0, rot = 0) => { const p = []; for (let i = 0; i < n; i++) { const a = rot + i / n * TAU; p.push([cx + Math.cos(a) * rx + jit(j), cy + Math.sin(a) * ry + jit(j)]); } return p; };
  function rrPts(x, y, w, h, r, j = 0) {
    const p = [], seg = 5, corner = (cx, cy, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + i / seg * Math.PI / 2; p.push([cx + Math.cos(a) * r + jit(j), cy + Math.sin(a) * r + jit(j)]); } };
    corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
    return p;
  }
  const starPts = (cx, cy, r, inner = .38, n = 4, rot = -Math.PI / 2) => { const p = []; for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n, q = i % 2 ? r * inner : r; p.push([cx + Math.cos(a) * q, cy + Math.sin(a) * q]); } return p; };
  const heartPts = (cx, cy, r, n = 22) => { const p = []; for (let i = 0; i < n; i++) { const a = i / n * TAU; p.push([cx + 16 * Math.pow(Math.sin(a), 3) * r / 16, cy - (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) * r / 16]); } return p; };

  // ---------- paint: one call = one painted shape (flat wash / watercolour fill / hatch / tapered ink outline) ----------
  function paint(pts, o = {}) {
    if (o.wash || o.fill || o.hatch) {
      if (o.wash) brush.wash(o.wash, o.washOp ?? 255); else brush.noWash();
      if (o.fill) { brush.fill(o.fill, o.fillOp ?? 170); brush.fillBleed(o.bleed ?? .1); brush.fillTexture(o.tex ?? .4, o.border ?? .35); } else brush.noFill();
      if (o.hatch) { brush.hatch(o.hatch.d, o.hatch.a, o.hatch.o || { rand: .15 }); brush.hatchStyle(o.hatch.b || 'HB', o.hatch.c || PAL.ink, o.hatch.w || 1); } else brush.noHatch();
      brush.noStroke();
      if (o.curv) { brush.beginShape(o.curv); for (const p of pts) brush.vertex(p[0], p[1]); brush.endShape(true); }
      else brush.polygon(pts);
    }
    if (o.ink !== null) {
      brush.noWash(); brush.noFill(); brush.noHatch(); brush.set(o.br || 'ink', o.ink || PAL.ink, o.sw ?? 1);
      brush.beginShape(o.curv || 0); for (const p of pts) brush.vertex(p[0], p[1]); brush.endShape(true);
    }
  }
  function inkLine(pts, sw = 1, col = PAL.ink, br = 'ink', curv = .5) { brush.noFill(); brush.noWash(); brush.noHatch(); brush.set(br, col, sw); brush.spline(pts, curv); }

  // ---------- camera: world point (cx, cy) lands at screen centre. Pair camBegin/camEnd; one level only. ----------
  let CAM = null;
  function camBegin(cx = VIDEO.W / 2, cy = VIDEO.H / 2, zoom = 1, rot = 0) { P.push(); P.translate(VIDEO.W / 2, VIDEO.H / 2); P.rotate(rot); P.scale(zoom); P.translate(-cx, -cy); CAM = { cx, cy, zoom, rot }; }
  function camEnd() { P.pop(); CAM = null; }
  function toScreen(x, y) {
    if (!CAM) return [x, y];
    const c = Math.cos(CAM.rot), s = Math.sin(CAM.rot), dx = (x - CAM.cx) * CAM.zoom, dy = (y - CAM.cy) * CAM.zoom;
    return [VIDEO.W / 2 + dx * c - dy * s, VIDEO.H / 2 + dx * s + dy * c];
  }
  const shakeXY = (t, amt) => { const f = Math.floor(t * 24); return [(hash(f * 1.7) - .5) * 2 * amt, (hash(f * 2.3 + 9) - .5) * 2 * amt]; };

  // ---------- full-frame effects (screen space, outside the camera) ----------
  function flash(k, col = '#FFFDF6') { if (k > .01) paint(rectPts(-60, -60, VIDEO.W + 120, VIDEO.H + 120), { wash: col, washOp: 255 * clamp(k), ink: null }); }
  function irisShape(pts, col = PAL.ink, far = 4000) {
    const n = pts.length; let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= n; cy /= n;
    const out = p => { const dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy) || 1; return [cx + dx / d * far, cy + dy / d * far]; };
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], ex = (b[0] - a[0]) * .06, ey = (b[1] - a[1]) * .06, a2 = [a[0] - ex, a[1] - ey], b2 = [b[0] + ex, b[1] + ey];
      paint([a2, b2, out(b2), out(a2)], { wash: col, washOp: 255, ink: null });
    }
  }
  function iris(cx, cy, r, col = PAL.ink) { if (r < 4) paint(rectPts(-60, -60, VIDEO.W + 120, VIDEO.H + 120), { wash: col, ink: null }); else irisShape(ellPts(cx, cy, r, r, 40), col); }
  // Brush-stroke wipe: fat paint strokes sweep across (p 0 → .5 covers, .5 → 1 uncovers). Use it across a cut.
  function brushWipe(p, c1 = PAL.clayDk, c2 = PAL.clay, seed = 0) {
    const W = VIDEO.W, H = VIDEO.H, n = 5, bh = (H + 420) / n + 40;
    P.push(); P.translate(W / 2, H / 2); P.rotate(-.1); P.translate(-W / 2, -H / 2);
    for (let i = 0; i < n; i++) {
      const y0 = -230 + i * (H + 420) / n, d = [0, .14, .06, .18, .1][i];
      const q = p < .5 ? easeOut(clamp((p * 2 - d) / (1 - d))) : ease(clamp(((p - .5) * 2 - d) / (1 - d)));
      const x0 = p < .5 ? -300 : lerp(-300, W + 400, q), x1 = p < .5 ? lerp(-300, W + 400, q) : W + 400;
      if (x1 - x0 < 30) continue;
      const pts = [], rag = (k, side) => side * (40 + 50 * hash(seed * 97 + i * 31 + k)) + jit(12);
      for (let k = 0; k <= 8; k++) pts.push([lerp(x0, x1, k / 8), y0 + Math.sin(k * .9 + i) * 14 + jit(5)]);
      for (let k = 1; k < 9; k++) pts.push([x1 + rag(k, 1) - 40, y0 + bh * k / 9]);
      for (let k = 8; k >= 0; k--) pts.push([lerp(x0, x1, k / 8), y0 + bh + Math.sin(k * .8 + i * 2) * 14 + jit(5)]);
      if (p >= .5) for (let k = 8; k > 0; k--) pts.push([x0 - rag(k + 20, 1) + 40, y0 + bh * k / 9]);
      paint(pts, { wash: i % 2 ? c1 : c2, washOp: 255, fill: i % 2 ? c2 : c1, fillOp: 70, bleed: .05, tex: .8, border: .6, ink: null,
        hatch: { d: 44, a: 0, o: { rand: .6, gradient: .5 }, b: 'charcoal', c: i % 2 ? c2 : PAL.cream, w: .8 } });
    }
    P.pop();
  }

  // ---------- lettering (drawn on the output canvas after the painting, under the grain) ----------
  function letter(txt, x, y, size, color, o = {}) {
    if (CAM && !o.screen) { [x, y] = toScreen(x, y); size *= CAM.zoom; o = { ...o, rot: (o.rot || 0) + CAM.rot }; }
    LETTERS.push({ txt, x, y, size, color, ...o });
  }
  function sfx(txt, x, y, size, color, age, o = {}) {
    const life = o.life ?? 1.2; if (age < 0 || age > life) return;
    letter(txt, x, y, size, color, { pop: age * 5, rot: (o.rot ?? -.08) + Math.sin(age * 20) * .03 * (1 - age / life), alpha: 1 - seg(age, life - .25, life), ...o });
  }
  function drawLetters(c) {
    for (const L of LETTERS.splice(0)) {
      const k = L.pop != null ? backOut(L.pop) : 1; if (k <= .01) continue;
      c.save(); c.translate(L.x, L.y); c.rotate(L.rot || 0); c.scale(k, k); c.globalAlpha = L.alpha ?? 1;
      c.font = L.font || `${L.size}px ${PAINT.letterFont || '"Permanent Marker", "Comic Sans MS", cursive'}`;
      c.textAlign = L.align || 'center'; c.textBaseline = 'middle';
      if (L.stroke) { c.lineJoin = 'round'; c.lineWidth = L.size * .12; c.strokeStyle = L.stroke; c.strokeText(L.txt, 0, 0); }
      if (L.ink !== false) { c.fillStyle = PAL.ink; c.fillText(L.txt, L.size * .045, L.size * .055); }
      c.fillStyle = L.color; c.fillText(L.txt, 0, 0);
      c.restore();
    }
  }

  // ---------- paper + grain ----------
  function lcg(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
  function makePaper() {
    const W = VIDEO.W, H = VIDEO.H, g = P.createGraphics(W, H); g.pixelDensity(1); const c = g.drawingContext, rnd = lcg(11), k = W / 1920;
    c.fillStyle = PAINT.paperColor || PAL.paper; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) { const x = rnd() * W, y = rnd() * H, r = (120 + rnd() * 380) * k, gr = c.createRadialGradient(x, y, 0, x, y, r), a = .045 * rnd(); gr.addColorStop(0, `rgba(160,125,80,${a})`); gr.addColorStop(1, 'rgba(160,125,80,0)'); c.fillStyle = gr; c.fillRect(x - r, y - r, 2 * r, 2 * r); }
    c.lineWidth = 1;
    for (let i = 0; i < 1400 * k * k + 200; i++) { const x = rnd() * W, y = rnd() * H, l = (6 + rnd() * 26) * k, a = rnd() * TAU; c.strokeStyle = `rgba(110,88,60,${.035 + rnd() * .06})`; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a + .6) * l * .5, y + Math.sin(a + .6) * l * .5, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
    return g;
  }
  function makeGrain() {
    const W = VIDEO.W, H = VIDEO.H, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d'), rnd = lcg(5);
    const id = c.createImageData(W, H), d = id.data, amt = 34 * PAINT.grain / .55;
    for (let i = 0; i < d.length; i += 4) { const v = 255 - (rnd() < .55 ? rnd() * rnd() * amt : 0); d[i] = v; d[i + 1] = v - 1; d[i + 2] = v - 3; d[i + 3] = 255; }
    c.putImageData(id, 0, 0);
    const g = c.createRadialGradient(W / 2, H / 2, H * .45, W / 2, H / 2, H * 1.05); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(120,95,70,${PAINT.vignette})`);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    return cv;
  }
  function defineBrushes() {
    brush.add('ink', { type: 'default', weight: 5, scatter: .25, sharpness: .8, grain: 40, opacity: 235, spacing: .2, pressure: [1.15, .75], rotate: 'natural', noise: .15 });
    brush.add('inkfine', { type: 'default', weight: 2.6, scatter: .15, sharpness: .85, grain: 40, opacity: 230, spacing: .2, pressure: [1.1, .8], rotate: 'natural', noise: .1 });
    brush.add('dry', { type: 'default', weight: 14, scatter: 3, sharpness: .3, grain: 6, opacity: 90, spacing: .6, pressure: [1, .6], rotate: 'natural', noise: .4 });
  }

  // ---------- wiring into the runtime ----------
  VIDEO.setup(() => new Promise(ready => {
    new p5(p => {
      brush.instance(p);
      p.setup = () => {
        p.createCanvas(VIDEO.W, VIDEO.H, p.WEBGL); p.pixelDensity(1); p.noLoop();
        p.canvas.classList.add('offscreen');
        brush.scaleBrushes(PAINT.brushScale ?? 5 * VIDEO.W / 1920); defineBrushes();
        P = p; paperG = makePaper(); grainC = makeGrain();
        VIDEO.useSource(p.canvas);
        ready();
      };
      p.draw = () => {
        if (!pending) return;
        const job = pending;
        p.push(); p.translate(-VIDEO.W / 2, -VIDEO.H / 2);
        p.randomSeed(1000 + Math.floor(VIDEO.T * PAINT.boil)); p.noiseSeed(77);
        p.image(paperG, 0, 0);
        try { job.fn(); } catch (e) { job.error = e; }
        CAM = null; p.pop();
      };
    });
  }));
  // Letters, then the paper grain multiplied over everything (before the runtime's captions).
  VIDEO.overlay(() => {
    const c = VIDEO.ctx; drawLetters(c);
    if (grainC && PAINT.grain > 0) { c.save(); c.globalCompositeOperation = 'multiply'; c.drawImage(grainC, 0, 0); c.restore(); }
  });

  // Wrap a shot function so it runs inside p5's draw (required by p5.brush).
  function painted(fn) {
    return async (t, lt, dur, info) => {
      const job = { fn: () => fn(t, lt, dur, info), error: null };
      pending = job; await P.redraw(); pending = null;
      if (job.error) throw job.error;
    };
  }

  // p5 transform helpers bound to the painted canvas, for use inside painted shots.
  const bind = name => (...a) => P[name](...a);
  Object.assign(window, {
    PAL, PAINT, painted, paint, inkLine, rectPts, ellPts, rrPts, starPts, heartPts, camBegin, camEnd, toScreen, shakeXY,
    flash, iris, irisShape, brushWipe, letter, sfx,
    push: bind('push'), pop: bind('pop'), translate: bind('translate'), rotate: bind('rotate'), scale: bind('scale'), resetMatrix: bind('resetMatrix'), image: bind('image'),
  });
})();
