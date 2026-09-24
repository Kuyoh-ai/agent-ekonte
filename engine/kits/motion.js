// motion.js: Canvas2D finishing kit for motion-graphics looks. Flat shapes alone read as clip-art; this kit adds the
// layers that make a frame feel produced: camera moves, soft light, texture, grain, depth, particles and transitions.
// Load after the runtime: <script src="/engine/kits/motion.js"></script>. Everything draws on a 2D context `c`
// (normally VIDEO.ctx) in pixels, y down. All helpers are deterministic (pure functions of their arguments and t).
(() => {
  'use strict';
  const cache = new Map();

  // ---------- camera ----------
  // cam2d(c, cx, cy, zoom, rot): world point (cx, cy) lands at screen centre. Always pair with cam2dEnd(c).
  function cam2d(c, cx = VIDEO.W / 2, cy = VIDEO.H / 2, zoom = 1, rot = 0) {
    c.save(); c.translate(VIDEO.W / 2, VIDEO.H / 2); c.rotate(rot); c.scale(zoom, zoom); c.translate(-cx, -cy);
  }
  const cam2dEnd = c => c.restore();
  const shake = (t, amt, fps = 24) => { const f = Math.floor(t * fps); return [(hash(f * 1.7) - .5) * 2 * amt, (hash(f * 2.3 + 9) - .5) * 2 * amt]; };
  // Parallax: offset for a layer at depth d (0 = at the camera's focus, 1 = far away) when the camera moves by (dx, dy).
  const parallax = (dx, dy, d) => [dx * (1 - d), dy * (1 - d)];

  // ---------- shapes ----------
  // Smooth closed (or open) curve through points (Catmull-Rom). Pass wobble > 0 for a hand-drawn edge that boils.
  function curve(c, pts, { closed = true, wobble = 0 } = {}) {
    const p = wobble ? pts.map(([x, y]) => [x + jit(wobble), y + jit(wobble)]) : pts, n = p.length;
    c.beginPath(); c.moveTo(p[0][0], p[0][1]);
    const at = i => p[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      c.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    if (closed) c.closePath();
  }
  const blobPts = (cx, cy, r, n = 9, irregular = .18, seed = 1) => Array.from({ length: n }, (_, i) => {
    const a = i / n * TAU, k = 1 + (hash(seed * 31 + i) - .5) * 2 * irregular; return [cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k];
  });
  // Fill + optional stroke + optional texture in one call.
  function shape(c, drawPath, { fill, stroke, width = 2, texture = 0, textureKind = 'grain', shadow } = {}) {
    c.save();
    if (shadow) { c.shadowColor = shadow.color || 'rgba(0,0,0,.25)'; c.shadowBlur = shadow.blur ?? 24; c.shadowOffsetX = shadow.dx ?? 0; c.shadowOffsetY = shadow.dy ?? 10; }
    drawPath(c);
    if (fill) { c.fillStyle = fill; c.fill(); }
    c.shadowColor = 'transparent';
    if (texture > 0) { c.save(); c.clip(); c.globalAlpha = texture; c.globalCompositeOperation = 'multiply'; c.fillStyle = c.createPattern(tex(textureKind), 'repeat'); c.fillRect(-VIDEO.W, -VIDEO.H, VIDEO.W * 3, VIDEO.H * 3); c.restore(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); }
    c.restore();
  }

  // ---------- light & colour ----------
  function glow(c, x, y, r, color, alpha = .6, mode = 'screen') {
    c.save(); c.globalCompositeOperation = mode; const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)'); c.globalAlpha = alpha; c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); c.restore();
  }
  function gradientRect(c, x, y, w, h, stops, angle = Math.PI / 2) {
    const cx = x + w / 2, cy = y + h / 2, L = Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle));
    const g = c.createLinearGradient(cx - Math.cos(angle) * L / 2, cy - Math.sin(angle) * L / 2, cx + Math.cos(angle) * L / 2, cy + Math.sin(angle) * L / 2);
    stops.forEach((s, i) => g.addColorStop(Array.isArray(s) ? s[0] : i / (stops.length - 1), Array.isArray(s) ? s[1] : s));
    c.fillStyle = g; c.fillRect(x, y, w, h);
  }
  // Atmospheric depth: mix a colour toward the haze colour by depth d (0 near .. 1 far).
  const haze = (color, hazeColor, d) => mixCol(color, hazeColor, clamp(d) * .85);

  // ---------- textures (cached canvases) ----------
  function tex(kind = 'grain', size = 256) {
    const key = kind + size; if (cache.has(key)) return cache.get(key);
    const cv = document.createElement('canvas'); cv.width = cv.height = size; const c = cv.getContext('2d'), r = rng(kind.length * 97 + size);
    c.fillStyle = '#fff'; c.fillRect(0, 0, size, size);
    if (kind === 'grain') { const id = c.getImageData(0, 0, size, size); for (let i = 0; i < id.data.length; i += 4) { const v = 255 - r() * r() * 70; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; } c.putImageData(id, 0, 0); }
    else if (kind === 'paper') { for (let i = 0; i < 900; i++) { c.strokeStyle = `rgba(90,80,70,${.04 + r() * .07})`; c.lineWidth = 1; const x = r() * size, y = r() * size, a = r() * TAU, l = 4 + r() * 16; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); } }
    else if (kind === 'halftone') { c.fillStyle = 'rgba(0,0,0,.35)'; for (let y = 0; y < size; y += 8) for (let x = (y / 8 % 2) * 4; x < size; x += 8) { c.beginPath(); c.arc(x, y, 1.6, 0, TAU); c.fill(); } }
    else if (kind === 'hatch') { c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = 1.2; for (let i = -size; i < size * 2; i += 7) { c.beginPath(); c.moveTo(i + r() * 2, 0); c.lineTo(i - size + r() * 2, size); c.stroke(); } }
    cache.set(key, cv); return cv;
  }

  // ---------- particles ----------
  // Deterministic particles: each lives `life` s, respawning every `period` s from spawn(i, gen) → {x, y, vx, vy}.
  // Returns [{ i, x, y, age, k (0..1 of life) }] for time t. Gravity/drag are applied analytically.
  function particles(n, t, { life = 1.5, period, gravity = 0, drag = 0, spawn }) {
    const out = [], per = period ?? life;
    for (let i = 0; i < n; i++) {
      const off = hash(i * 7.3) * per, local = t + off, gen = Math.floor(local / per), age = local - gen * per;
      if (age > life) continue;
      const s = spawn(i, gen), dragK = drag ? (1 - Math.exp(-drag * age)) / drag : age;
      out.push({ i, gen, age, k: age / life, x: s.x + (s.vx || 0) * dragK, y: s.y + (s.vy || 0) * dragK + .5 * gravity * age * age, ...s.extra });
    }
    return out;
  }

  // ---------- type ----------
  // Pop-in title/sfx: scales in with overshoot, optional outline and drop shadow. age = seconds since it appears.
  function popText(c, txt, x, y, size, color, age, { font = 'system-ui, sans-serif', weight = 800, outline, shadow = 'rgba(0,0,0,.25)', rot = 0, life = Infinity, align = 'center' } = {}) {
    if (age < 0 || age > life) return;
    const k = backOut(age * 4), a = 1 - seg(age, life - .25, life); if (k < .01) return;
    c.save(); c.translate(x, y); c.rotate(rot); c.scale(k, k); c.globalAlpha = a;
    c.font = `${weight} ${size}px ${font}`; c.textAlign = align; c.textBaseline = 'middle';
    if (shadow) { c.fillStyle = shadow; c.fillText(txt, size * .04, size * .06); }
    if (outline) { c.lineJoin = 'round'; c.lineWidth = size * .14; c.strokeStyle = outline; c.strokeText(txt, 0, 0); }
    c.fillStyle = color; c.fillText(txt, 0, 0); c.restore();
  }

  // ---------- transitions (p: 0 → .5 covers, .5 → 1 uncovers; cut to the next shot at p = .5) ----------
  function wipe(c, p, colors = ['#111'], angle = -.12) {
    const W = VIDEO.W, H = VIDEO.H, n = colors.length;
    c.save(); c.translate(W / 2, H / 2); c.rotate(angle); c.translate(-W / 2, -H / 2);
    colors.forEach((col, i) => {
      const d = i * .08, q = p < .5 ? easeInOut(clamp((p * 2 - d) / (1 - d))) : easeInOut(clamp(((p - .5) * 2 - d) / (1 - d)));
      const x0 = p < .5 ? -W * .2 : lerp(-W * .2, W * 1.3, q), x1 = p < .5 ? lerp(-W * .2, W * 1.3, q) : W * 1.3;
      c.fillStyle = col; c.fillRect(x0, -H * .3 + i * 6, x1 - x0, H * 1.6);
    });
    c.restore();
  }
  function irisWipe(c, p, x, y, color = '#111') {
    const R = Math.hypot(VIDEO.W, VIDEO.H), r = p < .5 ? lerp(R, 0, easeIn(p * 2)) : lerp(0, R, easeOut((p - .5) * 2));
    c.save(); c.fillStyle = color; c.beginPath(); c.rect(0, 0, VIDEO.W, VIDEO.H); c.arc(x, y, Math.max(0, r), 0, TAU, true); c.fill('evenodd'); c.restore();
  }

  // ---------- finish: grain, vignette, light leak (one call per project, e.g. in lib/shared.js) ----------
  function finish({ grain = .35, vignette = .3, leak = 0, leakColor = '#ffb070' } = {}) {
    VIDEO.overlay(t => {
      const c = VIDEO.ctx, W = VIDEO.W, H = VIDEO.H;
      if (leak > 0) glow(c, W * (.15 + .1 * Math.sin(t * .4)), H * .1, W * .6, leakColor, leak, 'screen');
      if (vignette > 0) { const g = c.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, Math.hypot(W, H) * .6); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${vignette})`); c.fillStyle = g; c.fillRect(0, 0, W, H); }
      if (grain > 0) { c.save(); c.globalAlpha = grain; c.globalCompositeOperation = 'multiply'; const pat = c.createPattern(tex('grain'), 'repeat'); const f = Math.floor(t * 12); c.translate(hash(f) * 256, hash(f + 5) * 256); c.fillStyle = pat; c.fillRect(-256, -256, W + 512, H + 512); c.restore(); }
    });
  }

  Object.assign(window, { cam2d, cam2dEnd, shake, parallax, curve, blobPts, shape, glow, gradientRect, haze, tex, particles, popText, wipe, irisWipe, finish });
})();
