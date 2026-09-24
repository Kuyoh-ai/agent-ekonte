// vector.js: Canvas2D vector-illustration kit for anime / chibi character work (cel look, morphable parts).
// Load after runtime.js (and after motion.js if you also want its camera/finish helpers):
//   <script src="/engine/kits/vector.js"></script>
// Everything here is a pure function of its arguments (and the per-frame rand()/jit() of the runtime), so shots stay
// pure functions of t. Coordinates are pixels, y down. `c` is a 2D context (normally VIDEO.ctx).
//
// Layers of the kit:
//   1. curves   smooth(pts) → cubic Bézier through points (Catmull-Rom, per-point corners), sample / resample / normals
//   2. strokes  taper(pts, widthFn) → polygon of a variable-width brush stroke (入り抜き), tapered ink lines
//   3. morph    morph(A, B, k) for equal-length point lists, morphShape(A, B, k) for any two closed shapes
//   4. cel      shape(fill / shade clipped to the base / highlight / outline), group() for a silhouette-only outline
//   5. parts    animeEye(), mouthShape(), tuft() (hair), catEar(), tail(), blush(), emotes (anger / sweat / sparkle)
//   6. rig      chibi(c, spec, pose) — a head-heavy character built from a spec object (see VECTOR_GUIDE.md)
(() => {
  'use strict';
  const P = (p) => Array.isArray(p) ? { x: p[0], y: p[1], corner: p[2] === 'c' || p[2] === true } : p;
  const norm = pts => pts.map(P);

  // ---------- 1. curves ----------
  // Cubic Bézier segments through points (Catmull-Rom → Bézier). A point marked corner ([x, y, 'c']) gets a sharp cusp.
  // tension 1 = classic Catmull-Rom, 0 = straight lines. Returns [{ p0, c1, c2, p1 }].
  function smooth(points, { closed = true, tension = 1 } = {}) {
    const p = norm(points), n = p.length, segs = [];
    if (n < 2) return segs;
    const at = i => p[closed ? (i % n + n) % n : Math.max(0, Math.min(n - 1, i))];
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = at(i - 1), b = at(i), cc = at(i + 1), d = at(i + 2), k = tension / 6;
      const c1 = b.corner ? { x: b.x, y: b.y } : { x: b.x + (cc.x - a.x) * k, y: b.y + (cc.y - a.y) * k };
      const c2 = cc.corner ? { x: cc.x, y: cc.y } : { x: cc.x - (d.x - b.x) * k, y: cc.y - (d.y - b.y) * k };
      segs.push({ p0: b, c1, c2, p1: cc });
    }
    return segs;
  }
  const cubicAt = (s, t) => { const u = 1 - t; return { x: u * u * u * s.p0.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.p1.x, y: u * u * u * s.p0.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.p1.y }; };
  const cubicTan = (s, t) => { const u = 1 - t; return { x: 3 * u * u * (s.c1.x - s.p0.x) + 6 * u * t * (s.c2.x - s.c1.x) + 3 * t * t * (s.p1.x - s.c2.x), y: 3 * u * u * (s.c1.y - s.p0.y) + 6 * u * t * (s.c2.y - s.c1.y) + 3 * t * t * (s.p1.y - s.c2.y) }; };
  // Trace a smooth path on the context (no beginPath/closePath of its own when `raw`).
  function tracePath(c, points, opts = {}) {
    const p = norm(points); if (!p.length) return;
    const wob = opts.wobble || 0, q = wob ? p.map(o => ({ ...o, x: o.x + jit(wob), y: o.y + jit(wob) })) : p;
    if (!opts.raw) c.beginPath();
    c.moveTo(q[0].x, q[0].y);
    if (opts.tension === 0) { for (let i = 1; i < q.length; i++) c.lineTo(q[i].x, q[i].y); }
    else for (const s of smooth(q, { closed: opts.closed !== false, tension: opts.tension ?? 1 })) c.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p1.x, s.p1.y);
    if (opts.closed !== false) c.closePath();
  }
  // Sample the smooth curve into `n` points (per-segment uniform t; good enough for strokes and morph targets).
  function sample(points, n = 64, opts = {}) {
    const segs = smooth(points, { closed: opts.closed !== false, tension: opts.tension ?? 1 }), out = [];
    if (!segs.length) return norm(points).map(o => ({ x: o.x, y: o.y }));
    const per = n / segs.length;
    for (let i = 0; i < n; i++) { const f = i / per, si = Math.min(segs.length - 1, Math.floor(f)); out.push(cubicAt(segs[si], f - si)); }
    if (opts.closed === false) out.push({ ...segs[segs.length - 1].p1 });
    return out;
  }
  // Resample by arc length to exactly n points (closed: n points around; open: n points from start to end).
  function resample(points, n = 32, opts = {}) {
    const closed = opts.closed !== false, dense = sample(points, Math.max(n * 8, 128), opts);
    const src = closed ? dense.concat([dense[0]]) : dense, L = [0];
    for (let i = 1; i < src.length; i++) L.push(L[i - 1] + Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y));
    const total = L[L.length - 1], out = [], m = closed ? n : n - 1;
    let j = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.min(total, total * i / Math.max(1, m));
      while (j < src.length - 2 && L[j + 1] < d) j++;
      const k = (d - L[j]) / Math.max(1e-9, L[j + 1] - L[j]);
      out.push({ x: src[j].x + (src[j + 1].x - src[j].x) * k, y: src[j].y + (src[j + 1].y - src[j].y) * k });
    }
    return out;
  }
  // Unit normals for a polyline (left-hand side).
  function normals(pts, closed = false) {
    const n = pts.length; return pts.map((p, i) => {
      const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: -dy / l, y: dx / l };
    });
  }
  const pathLength = pts => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return l; };

  // ---------- 2. strokes with width (入り抜き) ----------
  // taper(points, width) → closed polygon around the centerline. width is a number, or a function w(s) with s 0..1 along
  // the stroke. Presets: taperProfile('inout' | 'in' | 'out' | 'brush' | 'leaf', maxWidth).
  function taperProfile(kind, w) {
    if (kind === 'in') return s => w * Math.min(1, s * 3);
    if (kind === 'out') return s => w * Math.min(1, (1 - s) * 3);
    if (kind === 'inout') return s => w * Math.min(1, s * 3, (1 - s) * 3);
    if (kind === 'brush') return s => w * (.35 + .65 * Math.sin(Math.PI * Math.min(1, s * 1.15)));
    if (kind === 'leaf') return s => w * Math.sin(Math.PI * Math.pow(s, .7));
    return () => w;
  }
  function taper(points, width, opts = {}) {
    const n = opts.samples || Math.max(12, Math.min(96, Math.round(pathLength(norm(points)) / 6)));
    const cl = sample(points, n, { closed: false, tension: opts.tension ?? 1 }), nr = normals(cl), wf = typeof width === 'function' ? width : () => width;
    const L = [], R = [];
    for (let i = 0; i < cl.length; i++) { const s = i / (cl.length - 1), w = wf(s) / 2; L.push({ x: cl[i].x + nr[i].x * w, y: cl[i].y + nr[i].y * w }); R.push({ x: cl[i].x - nr[i].x * w, y: cl[i].y - nr[i].y * w }); }
    return L.concat(R.reverse());
  }
  // Ink line with entry/exit taper. profile: see taperProfile. Fills the polygon (no stroke) so the ends are pointed.
  function ink(c, points, w, color = '#1c1a22', profile = 'inout', opts = {}) {
    const poly = taper(points, taperProfile(profile, w), opts);
    c.save(); c.fillStyle = color; tracePath(c, poly, { closed: true, tension: 0 }); c.fill(); c.restore();
  }

  // ---------- 3. morphing ----------
  const lerpPt = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
  // Equal-length lists (arrays [x, y] or {x, y}); k 0..1. Corner flags are taken from A below .5 and B above.
  function morph(A, B, k) {
    const a = norm(A), b = norm(B); if (a.length !== b.length) throw new Error(`morph: ${a.length} vs ${b.length} points`);
    return a.map((p, i) => ({ ...lerpPt(p, b[i], k), corner: k < .5 ? p.corner : b[i].corner }));
  }
  // Any two closed shapes: resample both to n points, rotate B's start to the closest match, then lerp.
  function morphShape(A, B, k, n = 32) {
    const a = resample(A, n), b0 = resample(B, n);
    let best = 0, bestD = Infinity;
    for (let r = 0; r < n; r++) { let d = 0; for (let i = 0; i < n; i++) { const q = b0[(i + r) % n]; d += (a[i].x - q.x) ** 2 + (a[i].y - q.y) ** 2; } if (d < bestD) { bestD = d; best = r; } }
    // also try the reversed orientation
    const b1 = b0.slice().reverse(); let bestR = -1;
    for (let r = 0; r < n; r++) { let d = 0; for (let i = 0; i < n; i++) { const q = b1[(i + r) % n]; d += (a[i].x - q.x) ** 2 + (a[i].y - q.y) ** 2; } if (d < bestD) { bestD = d; bestR = r; } }
    const b = bestR >= 0 ? b1.map((_, i) => b1[(i + bestR) % n]) : b0.map((_, i) => b0[(i + best) % n]);
    return a.map((p, i) => lerpPt(p, b[i], k));
  }
  // Multi-target blend: targets = { name: pts }, weights = { name: w } (normalised). All targets equal length.
  function blend(targets, weights) {
    const names = Object.keys(weights).filter(k => weights[k] > 0 && targets[k]); if (!names.length) return null;
    const tot = names.reduce((s, k) => s + weights[k], 0), base = norm(targets[names[0]]);
    return base.map((_, i) => { let x = 0, y = 0; for (const k of names) { const p = P(targets[k][i]); x += p.x * weights[k] / tot; y += p.y * weights[k] / tot; } return { x, y }; });
  }
  // Transform helpers for point lists (build parts in a local unit box, then place them).
  const xf = (pts, fn) => norm(pts).map(p => ({ ...p, ...fn(p) }));
  const place = (pts, x, y, sx = 1, sy = sx, rot = 0) => { const cs = Math.cos(rot), sn = Math.sin(rot); return xf(pts, p => ({ x: x + (p.x * sx) * cs - (p.y * sy) * sn, y: y + (p.x * sx) * sn + (p.y * sy) * cs })); };
  const flipX = pts => xf(pts, p => ({ x: -p.x }));

  // ---------- 4. cel shading ----------
  // shape(c, pts, opts): fill, then shade / light shapes clipped inside the base, then the outline.
  //   { fill, alpha, stroke, lw, closed, tension, wobble, shade: [{ pts, color, alpha, tension }], light: [...], shadow }
  // shade / light entries are drawn with c.clip() to the base path, so they can be rough and overshoot.
  function shape(c, pts, o = {}) {
    const trace = () => tracePath(c, pts, { closed: o.closed !== false, tension: o.tension, wobble: o.wobble });
    c.save();
    if (o.alpha != null) c.globalAlpha = o.alpha;
    if (o.shadow) { c.save(); c.shadowColor = o.shadow.color || 'rgba(0,0,0,.25)'; c.shadowBlur = o.shadow.blur ?? 16; c.shadowOffsetX = o.shadow.dx ?? 0; c.shadowOffsetY = o.shadow.dy ?? 6; trace(); c.fillStyle = o.fill || '#000'; c.fill(); c.restore(); }
    if (o.fill) { trace(); c.fillStyle = o.fill; c.fill(); }
    if (o.gradient) { trace(); c.fillStyle = o.gradient; c.fill(); }
    const inner = (list, mode) => { if (!list || !list.length) return; c.save(); trace(); c.clip(); c.globalCompositeOperation = mode;
      for (const s of list) { if (!s || !s.pts) continue; c.globalAlpha = (o.alpha ?? 1) * (s.alpha ?? 1); c.fillStyle = s.color; tracePath(c, s.pts, { closed: s.closed !== false, tension: s.tension ?? o.tension, wobble: s.wobble }); c.fill(); }
      c.restore(); };
    inner(o.shade, o.shadeMode || 'multiply'); inner(o.light, o.lightMode || 'source-over');
    if (o.stroke) { trace(); c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = o.lw ?? 2; c.strokeStyle = o.stroke; c.stroke(); }
    c.restore();
  }
  // group(c, [shape opts...], { outline, lw }): one thick outline around the UNION of the shapes (sticker / cel look),
  // then every shape filled on top without its own stroke. Inner lines are added explicitly with ink().
  function group(c, shapes, { outline = '#1c1a22', lw = 4, sticker, stickerW = 0 } = {}) {
    c.save();
    if (sticker) for (const s of shapes) { tracePath(c, s.pts, { closed: s.closed !== false, tension: s.tension }); c.lineJoin = 'round'; c.lineWidth = lw + stickerW * 2; c.strokeStyle = sticker; c.stroke(); c.fillStyle = sticker; c.fill(); }
    if (outline && lw > 0) for (const s of shapes) { tracePath(c, s.pts, { closed: s.closed !== false, tension: s.tension }); c.lineJoin = 'round'; c.lineWidth = lw; c.strokeStyle = outline; c.stroke(); }
    for (const s of shapes) shape(c, s.pts, { ...s, stroke: s.innerStroke, lw: s.innerLw });
    c.restore();
  }
  // Unit shapes (local coordinates) to build parts from.
  const circlePts = (cx, cy, r, n = 12) => Array.from({ length: n }, (_, i) => { const a = i / n * TAU; return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }; });
  const ellipsePts = (cx, cy, rx, ry, n = 12, rot = 0) => Array.from({ length: n }, (_, i) => { const a = i / n * TAU, x = Math.cos(a) * rx, y = Math.sin(a) * ry; return { x: cx + x * Math.cos(rot) - y * Math.sin(rot), y: cy + x * Math.sin(rot) + y * Math.cos(rot) }; });
  const roundRectPts = (x, y, w, h, r) => { r = Math.min(r, w / 2, h / 2); const k = r * .55; return [[x + r, y, 'c'], [x + w - r, y, 'c'], [x + w - r + k, y + r - k], [x + w, y + r, 'c'], [x + w, y + h - r, 'c'], [x + w - r + k, y + h - r + k], [x + w - r, y + h, 'c'], [x + r, y + h, 'c'], [x + r - k, y + h - r + k], [x, y + h - r, 'c'], [x, y + r, 'c'], [x + r - k, y + r - k]].map(P); };
  // A leaf / hair-tuft polygon from a spine (2-4 points) and a base width; the tip is pointed. curl bends the spine.
  function tuft(spine, w, { curl = 0, tip = 0, profile = 'leaf' } = {}) {
    const s = norm(spine), spineC = curl ? s.map((p, i) => { const k = i / (s.length - 1), n = normals(s)[i]; return { x: p.x + n.x * curl * w * k * k, y: p.y + n.y * curl * w * k * k }; }) : s;
    return taper(spineC, profile === 'leaf' ? (u => w * Math.max(tip, Math.sin(Math.PI * Math.pow(u, .55)) * (1 - u * .15))) : (u => w * ((1 - u) + tip * u)), { samples: 24 });
  }

  // ---------- 5. parts ----------
  const INK = '#1c1a22';
  // Anime eye in a local box: centre (0, 0), width w, height h (fully open). Everything scales with w.
  //  o: { open 0..1, style: 'round'|'sharp'|'happy'|'closed'|'xx'|'star'|'heart'|'swirl', iris, pupil, look: [dx, dy] (-1..1),
  //       lash 0..1, ink, sclera, highlight, glowColor, brow: { y, angle, w, style }, side: -1|1 (which side of the face) }
  function animeEye(c, w, h, o = {}) {
    const col = o.ink || INK, side = o.side || 1, open = o.open ?? 1, style = o.style || 'round';
    const lw = w * .07, lx = (o.look?.[0] || 0) * w * .12, ly = (o.look?.[1] || 0) * h * .12;
    c.save();
    if (style === 'xx') { // > < style: two thick chevrons per eye
      const k = w * .28; ink(c, [[-k, -h * .28], [k * .3, 0], [-k, h * .28]].map(p => [p[0] * side, p[1]]), lw * 2.6, col, 'none');
      ink(c, [[-k * .05 * side, -h * .34], [k * 1.3 * side, -h * .2]], lw * 2.2, col, 'none');
      c.restore(); return;
    }
    if (style === 'closed' || style === 'happy' || open < .12) {
      const up = style === 'happy' ? -1 : (style === 'closed' ? .35 : .15);
      ink(c, [[-w * .5, h * .05 * up], [0, h * .32 * up], [w * .5, h * .05 * up]], lw * 2.4, col, 'inout');
      c.restore(); return;
    }
    // sclera: heavy upper lid curve, flatter lower lid; open squashes it toward the lower lid line.
    const hh = h * (.35 + .65 * open), top = -hh * .5, bot = hh * .5;
    const outer = [[-w * .5, bot * .1, 'c'], [-w * .38, top * .55], [0, top], [w * .4, top * .6], [w * .5, bot * .05, 'c'], [w * .3, bot], [-w * .25, bot * .95]];
    c.save(); tracePath(c, outer); c.clip();
    c.fillStyle = o.sclera || '#fbfbff'; c.fillRect(-w, -h, w * 2, h * 2);
    // iris with gradient (dark top → light bottom), pupil, lower glow, highlights
    const ir = w * .3, iy = ly + hh * .05, ix = lx;
    const g = c.createLinearGradient(0, iy - ir, 0, iy + ir); const irc = o.iris || '#3ec7c0';
    g.addColorStop(0, mixCol(irc, '#101018', .55)); g.addColorStop(.55, irc); g.addColorStop(1, mixCol(irc, '#ffffff', .35));
    c.fillStyle = g; c.beginPath(); c.ellipse(ix, iy, ir * .78, ir * 1.05, 0, 0, TAU); c.fill();
    c.fillStyle = mixCol(irc, '#101018', .8); c.beginPath(); c.ellipse(ix, iy, ir * .32, ir * .5, 0, 0, TAU); c.fill();
    c.fillStyle = o.glowColor || mixCol(irc, '#ffffff', .7); c.globalAlpha = .7; c.beginPath(); c.ellipse(ix, iy + ir * .45, ir * .42, ir * .28, 0, 0, TAU); c.fill(); c.globalAlpha = 1;
    // upper shadow from the lid
    c.fillStyle = 'rgba(30,20,50,.28)'; c.beginPath(); c.moveTo(-w, top); c.lineTo(w, top); c.lineTo(w, top + hh * .22); c.lineTo(-w, top + hh * .22); c.fill();
    c.fillStyle = o.highlight || '#ffffff'; c.beginPath(); c.ellipse(ix - ir * .35 * side, iy - ir * .35, ir * .26, ir * .3, 0, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(ix + ir * .3 * side, iy + ir * .2, ir * .1, ir * .12, 0, 0, TAU); c.fill();
    c.restore();
    // lids: thick tapered upper line, thin lower line, lashes
    const upper = [[-w * .52, bot * .1], [-w * .38, top * .55], [0, top], [w * .4, top * .6], [w * .55, bot * .02]];
    ink(c, upper, lw * 3.2, col, 'brush');
    ink(c, [[-w * .3, bot * .9], [w * .05, bot * 1.02], [w * .42, bot * .6]], lw * 1.1, col, 'inout');
    const lash = o.lash ?? .6;
    if (lash > 0) { ink(c, [[w * .5 * side, top * .3], [w * (.5 + .3 * lash) * side, top * .55]], lw * 2.2, col, 'out'); ink(c, [[w * .3 * side, top * .8], [w * (.4 + .2 * lash) * side, top * 1.25]], lw * 1.6, col, 'out'); }
    if (o.brow) { const b = o.brow, by = top - h * (b.y ?? .55), a = (b.angle || 0) * side; ink(c, [[-w * .5, by + Math.sin(a) * w * .5 * -1], [-w * .05, by - w * .06], [w * .45, by + Math.sin(a) * w * .5]], lw * (b.w ?? 2.2), b.color || col, 'inout'); }
    c.restore();
  }
  // Mouth targets in a unit box (x -1..1, y -1..1, y down; mouth centre 0,0). All are 16-point closed polygons so any
  // two can be morphed with morph(). open = how much the mouth opens. Returns { pts, tongue, teeth, kind }.
  const MOUTH = {
    smile: [[-1, -.15], [-.6, -.05], [0, .05], [.6, -.05], [1, -.15], [.6, .12], [0, .22], [-.6, .12]],
    grin: [[-1, -.35], [-.5, -.15], [0, -.1], [.5, -.15], [1, -.35], [.55, .5], [0, .7], [-.55, .5]],
    o: [[-.45, -.55], [-.2, -.72], [.2, -.72], [.45, -.55], [.45, .55], [.2, .72], [-.2, .72], [-.45, .55]],
    shout: [[-1, -.45], [-.55, -.55], [0, -.6], [.55, -.55], [1, -.45], [.6, .95], [0, 1.15], [-.6, .95]],
    cat: [[-1, -.1], [-.5, .35], [0, -.05], [.5, .35], [1, -.1], [.5, .55], [0, .25], [-.5, .55]],
    flat: [[-.8, -.06], [-.4, -.06], [0, -.06], [.4, -.06], [.8, -.06], [.4, .06], [0, .06], [-.4, .06]],
    sad: [[-.9, .2], [-.5, -.05], [0, -.15], [.5, -.05], [.9, .2], [.5, .12], [0, .03], [-.5, .12]],
  };
  const mouthPts = kind => resample(MOUTH[kind] || MOUTH.smile, 16);
  // Draw a mouth: pts (unit box, from mouthPts / morph), size w (half-width in px), fill dark, tongue, teeth, fang, line.
  function mouth(c, pts, w, o = {}) {
    const col = o.ink || INK, p = place(pts, 0, 0, w, w), hgt = Math.max(...p.map(q => q.y)) - Math.min(...p.map(q => q.y));
    const openness = clamp((hgt - w * .2) / (w * 1.2));
    c.save();
    if (openness > .08) {
      shape(c, p, { fill: o.fill || '#7d1f3a', tension: .9 });
      c.save(); tracePath(c, p, { tension: .9 }); c.clip();
      if (o.tongue !== false) { c.fillStyle = o.tongueColor || '#e8607a'; c.beginPath(); c.ellipse(0, hgt * .55, w * .6, hgt * .45, 0, 0, TAU); c.fill(); }
      if (o.teeth) { c.fillStyle = '#fff'; c.beginPath(); const y0 = Math.min(...p.map(q => q.y)); c.rect(-w, y0 - 1, w * 2, hgt * .18); c.fill(); }
      c.restore();
      shape(c, p, { stroke: col, lw: w * .12, tension: .9 });
      if (o.fang) { const fx = w * .45 * (o.fang < 0 ? -1 : 1), y0 = Math.min(...p.map(q => q.y)); shape(c, [[fx - w * .12, y0 + w * .05], [fx + w * .12, y0 + w * .05], [fx, y0 + w * .38, 'c']], { fill: '#fff', stroke: col, lw: w * .06, tension: 0 }); }
    } else {
      // closed: draw the upper edge only as a tapered ink line
      const n = p.length, upper = p.slice(0, n / 2 + 1);
      ink(c, upper, w * .13, col, 'inout');
      if (o.fang) { const fx = w * .45 * (o.fang < 0 ? -1 : 1), yy = upper[Math.round(upper.length * .7)].y; shape(c, [[fx - w * .1, yy - w * .02], [fx + w * .1, yy - w * .02], [fx, yy + w * .28, 'c']], { fill: '#fff', stroke: col, lw: w * .05, tension: 0 }); }
    }
    c.restore();
  }
  function blush(c, x, y, w, color = '#f0857a', alpha = .55, lines = true) {
    c.save(); c.globalAlpha = alpha; c.fillStyle = color; c.beginPath(); c.ellipse(x, y, w, w * .45, 0, 0, TAU); c.fill();
    if (lines) { c.globalAlpha = alpha * .8; c.strokeStyle = mixCol(color, '#000000', .35); c.lineWidth = w * .07; c.lineCap = 'round'; for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(x + i * w * .35 - w * .1, y + w * .22); c.lineTo(x + i * w * .35 + w * .1, y - w * .22); c.stroke(); } }
    c.restore();
  }
  // Cat / fox ear: base points (bx0, by0)-(bx1, by1) on the head, tip at (tx, ty). side -1/1 for inner-fur direction.
  function earPts(bx0, by0, bx1, by1, tx, ty, bulge = .12) {
    const mx = (bx0 + tx) / 2, my = (by0 + ty) / 2, nx = (bx1 + tx) / 2, ny = (by1 + ty) / 2, dx = tx - (bx0 + bx1) / 2, dy = ty - (by0 + by1) / 2;
    return [[bx0, by0], [mx - dy * bulge, my + dx * bulge], [tx, ty, 'c'], [nx + dy * bulge, ny - dx * bulge], [bx1, by1]];
  }
  // Tail as a tapered curve: pts is the spine from base to tip; w the base width.
  const tailPts = (spine, w) => taper(spine, s => w * (1 - .15 * s) * Math.min(1, (1 - s) * 2.2 + .05), { samples: 40 });

  // Emotes (manga symbols). age in seconds since it appears; all deterministic.
  function emote(c, kind, x, y, s, age = 1, color) {
    const k = backOut(clamp(age * 3)); if (k <= 0) return;
    c.save(); c.translate(x, y); c.scale(k, k); c.lineCap = 'round'; c.lineJoin = 'round';
    if (kind === 'anger') { c.strokeStyle = color || '#e8384f'; c.lineWidth = s * .16; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; c.beginPath(); c.arc(Math.cos(a) * s * .32, Math.sin(a) * s * .32, s * .3, a + Math.PI * .35, a + Math.PI * 1.65); c.stroke(); } }
    else if (kind === 'sweat') { const d = [[0, -s * .5], [s * .32, s * .1], [s * .2, s * .45], [0, s * .5], [-s * .2, s * .45], [-s * .32, s * .1]]; shape(c, d, { fill: color || '#6fc3ff', stroke: INK, lw: s * .08, tension: .8 }); c.fillStyle = 'rgba(255,255,255,.8)'; c.beginPath(); c.ellipse(-s * .1, s * .05, s * .07, s * .16, .3, 0, TAU); c.fill(); }
    else if (kind === 'sparkle') { c.fillStyle = color || '#ffe36e'; const q = [[0, -s * .5], [s * .1, -s * .1], [s * .5, 0], [s * .1, s * .1], [0, s * .5], [-s * .1, s * .1], [-s * .5, 0], [-s * .1, -s * .1]]; shape(c, q.map(p => [p[0], p[1], 'c']), { fill: c.fillStyle, tension: 0 }); }
    else if (kind === 'note') { c.fillStyle = color || INK; c.font = `bold ${s}px serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('♪', 0, 0); }
    else if (kind === 'bang' || kind === 'q') { c.fillStyle = color || '#ffd23e'; c.strokeStyle = INK; c.lineWidth = s * .1; c.font = `900 ${s * 1.1}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.strokeText(kind === 'bang' ? '!' : '?', 0, 0); c.fillText(kind === 'bang' ? '!' : '?', 0, 0); }
    else if (kind === 'lines') { c.strokeStyle = color || INK; c.lineWidth = s * .08; for (let i = 0; i < 3; i++) { const a = -.5 + i * .5; c.beginPath(); c.moveTo(Math.cos(a) * s * .3, Math.sin(a) * s * .3); c.lineTo(Math.cos(a) * s * .7, Math.sin(a) * s * .7); c.stroke(); } }
    else if (kind === 'shout') { // the ") ) )" burst marks in the reference: 2-3 thick short strokes fanning out
      c.strokeStyle = color || '#f0a030'; c.lineWidth = s * .16; for (let i = 0; i < 3; i++) { const a = -.6 + i * .6; c.beginPath(); c.moveTo(Math.cos(a) * s * .25, Math.sin(a) * s * .25); c.lineTo(Math.cos(a) * s * .62, Math.sin(a) * s * .62); c.stroke(); } }
    c.restore();
  }

  // ---------- 6. secondary motion ----------
  // Delayed follow: the value of a smooth driver at time t - lag, blended with the current value. For hair / ears / tail.
  const follow = (fn, t, lag = .12, k = .7) => fn(t - lag) * k + fn(t) * (1 - k);
  // Idle bob for a standing chibi: { dy, tilt, squash } as pure functions of t.
  const idle = (t, amp = 1, f = .9) => ({ dy: Math.sin(t * f * TAU) * 4 * amp, tilt: Math.sin(t * f * TAU * .5 + 1) * .03 * amp, squash: Math.sin(t * f * TAU + .8) * .02 * amp });
  // Blink curve: 0 (open) → 1 (shut) → 0 over ~0.18 s, `every` seconds, offset by seed. Returns openness 0..1.
  const blinkOpen = (t, every = 3.4, seed = 0) => { const ph = (t + seed * 1.7) % every, k = ph / .18; return k >= 1 ? 1 : 1 - Math.sin(Math.min(1, k) * Math.PI); };

  Object.assign(window, {
    VEC: { smooth, cubicAt, cubicTan, sample, resample, normals, pathLength, MOUTH, INK },
    tracePath, taper, taperProfile, ink, morph, morphShape, blend, place, flipX, xf,
    shape, group, circlePts, ellipsePts, roundRectPts, tuft,
    animeEye, mouthPts, mouth, blush, earPts, tailPts, emote, follow, idle, blinkOpen,
  });
})();
