// chibi.js: a formula-driven chibi (SD) character rig on top of vector.js. Load after vector.js.
//
//   chibi(c, spec, pose)   draw one character. spec = ratios + colours (who), pose = expression / limbs / motion (now).
//   PARTS.*                the generators (head, hairOuter, bangs, sideLocks, backHair, tail, catEar, bean, tube, fist ...)
//
// Every part follows a construction rule from engine/VECTOR_GUIDE.md §8 (R1..R13), derived from drawing tutorials
// (engine/docs/research-chibi-head.md, research-chibi-body.md). Units: pose.s = head width H in px; local origin =
// head centre; y down; the skull is an ellipse rx .5, ry .47; face fraction f (0 top .. 1 bottom) → y = f - .5.
(() => {
  'use strict';
  const INKC = '#1c1a22';
  const RX = .5, RY = .47;                                       // skull ellipse (slightly wider than tall)
  const R = (seed) => { const r = rng(seed * 7919 + 13); return () => r(); };
  const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  const sample = VEC.sample;
  const shift = (pts, dx, dy) => pts.map(p => Array.isArray(p) ? [p[0] + dx, p[1] + dy, p[2]] : { ...p, x: p.x + dx, y: p.y + dy });
  const deg = d => d * Math.PI / 180;
  // point on the skull ellipse at angle a from straight up (positive = clockwise / to the right), scaled by k
  const onSkull = (a, k = 1) => [Math.sin(a) * RX * k, -Math.cos(a) * RY * k];

  // ---------- head (face) : mochi — round top, cheeks widest at `cheek`, wide round chin (R2/4) ----------
  function head({ cheek = .6, chin = .15, jaw = .74 } = {}) {
    const pts = [], n = 20;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU - Math.PI / 2, cx = Math.cos(a), sy = Math.sin(a), f = (sy + 1) / 2;
      let xr = 1;
      if (f > cheek) { const k = (f - cheek) / (1 - cheek); xr = 1 - (1 - jaw) * Math.pow(k, 1.9) - chin * .15 * k * k * k; }
      else { const k = 1 - f / cheek; xr = 1 - .04 * k * k; }
      pts.push({ x: cx * xr * RX, y: sy * RY * 1.06 });
    }
    return pts;
  }

  // ---------- R1: hair outline = skull × (1 + k(θ)), k .15 crown → .08 temples → 0 at the bottom ----------
  function hairOuter({ crown = .15, temple = .08, lean = 0 } = {}) {
    const pts = [];
    for (let i = 0; i < 28; i++) {
      const a = i / 28 * TAU, t = Math.abs(((a + Math.PI) % TAU) - Math.PI) / Math.PI;   // 0 top .. 1 bottom
      const k = t < .5 ? lerp(crown, temple, t / .5) : lerp(temple, 0, (t - .5) / .5);
      const p = onSkull(a, 1 + k); pts.push([p[0] + (t < .5 ? lean * .04 * (1 - t * 2) : 0), p[1] + k * .02]);
    }
    return pts;
  }

  // ---------- tufts ----------
  const tuftSpine = (bx, by, dir, len, curl, wob = 0) => { const nx = -dir[1], ny = dir[0]; return [[bx, by], [bx + dir[0] * len * .5 + nx * wob * len, by + dir[1] * len * .5 + ny * wob * len], [bx + dir[0] * len + nx * curl * len * .5, by + dir[1] * len + ny * curl * len * .5]]; };
  // profile: wide, then a taper; round .35 = pointed, .6 = soft
  const hairProfile = (w, round = .45) => u => w * (u < 1 - round ? 1 - u * .1 : (1 - .1 * (1 - round)) * Math.pow(Math.cos((u - (1 - round)) / round * Math.PI / 2), .8));
  const hairTuft = (spine, w, round) => taper(spine, hairProfile(w, round), { samples: 28 });

  // ---------- R2: bangs — big / small rhythm, tilt from the parting, tips at the top of the eyes ----------
  function bangs({ n = 5, part = -.3, tipY = .04, depth = .06, seed = 1, extraSide = 1 } = {}, sway = 0) {
    const rnd = R(seed), out = [], m = n + (extraSide ? 1 : 0);
    const big = i => i % 2 === 0, widths = Array.from({ length: m }, (_, i) => (big(i) ? 1 : .55) * (0.85 + rnd() * .3));
    const tot = widths.reduce((a, b) => a + b, 0), span = 1.02; let acc = extraSide > 0 ? 0 : 0;
    const x0 = -span / 2 - (extraSide > 0 ? 0 : .06);
    for (let i = 0; i < m; i++) {
      const w = widths[i] / tot * span, cx = x0 + (acc + widths[i] / 2) / tot * span; acc += widths[i];
      const dist = (cx - part * .2) / .5, tilt = Math.sign(dist) * deg(8 + 12 * Math.min(1, Math.abs(dist)));
      const d = big(i) ? 1 : .4, tip = tipY + depth * d * (0.85 + rnd() * .3) + Math.abs(cx) * .05;
      const root = -RY * .55, dir = unit(Math.sin(tilt) + sway * .3, Math.cos(tilt)), L = (tip - root) / dir[1];
      const spine = tuftSpine(cx, root, dir, L, (dist < 0 ? -1 : 1) * .25 + sway * .3, (rnd() - .5) * .08 + sway * .15);
      out.push({ spine, w: w * 1.25, round: big(i) ? .6 : .38, order: Math.abs(dist), big: big(i) });
      if (big(i)) out.push({ spine: tuftSpine(cx + w * .22, root, dir, L * .96, (dist < 0 ? -1 : 1) * .4, 0), w: w * .5, round: .38, order: Math.abs(dist) + .01, sub: true }); // split tip
    }
    return out.sort((a, b) => b.order - a.order);                  // far from the parting first, near on top
  }
  // ---------- R3: side locks — bulge to 1.12 rx at eye height, fall to the chin, curl in or flick out ----------
  function sideLocks({ length = 1.0, width = .28, curl = -.15, notch = true } = {}, sway = 0) {
    const out = [];
    for (const sd of [-1, 1]) {
      const spine = [[sd * RX * 1.02, -.2], [sd * RX * 1.12 + sway * .1, .12 + sway * .05], [sd * RX * (1.0 + curl) + sway * .35, .5 * length + sway * .05]];
      out.push({ spine, w: width, round: .5 });
      if (notch) out.push({ spine: [[sd * RX * .92, -.1], [sd * RX * .98 + sway * .08, .2], [sd * RX * (.78 + curl * .5) + sway * .25, .5 * length * .85]], w: width * .55, round: .4 });
    }
    return out;
  }
  // back hair: 'bob' = skull × 1.15 lower half with a scalloped hem; 'long' = to the waist
  function backHair({ style = 'bob', length = .6, seed = 3 } = {}, sway = 0) {
    const rnd = R(seed), pts = [], k = 1.15, hem = style === 'long' ? .5 + .9 * length : .5 + .25 * length, hw = RX * (style === 'long' ? 1.05 : k);
    pts.push([-RX * k, -.1], [-hw - .02, hem * .5], [-hw * .9, hem - .04]);
    const n = 5; for (let i = 0; i <= n; i++) { const u = i / n; pts.push([lerp(-hw * .9, hw * .9, u), hem + (i % 2 ? .05 : -.01) * (1 + rnd() * .5) + Math.sin(u * Math.PI) * .04]); }
    pts.push([hw * .9, hem - .04], [hw + .02, hem * .5], [RX * k, -.1], [0, -.3]);
    return pts.map(([x, y]) => [x + sway * .2 * Math.max(0, y), y]);
  }
  // ---------- R4: ponytail / side tail — up, then down (S), width sin(π t^.7), tip split ----------
  function tails({ style = 'ponytail', side = 1, length = 1.0 } = {}, sway = 0) {
    const knots = style === 'twin' ? [[-1, .48, -.15], [1, .48, -.15]] : [[side, .45, -.33]], out = [];
    for (const [sd, kx, ky] of knots) {
      const K = [sd * kx, ky], line = [K, [K[0] + sd * .15 + sway * .05, K[1] - .25], [K[0] + sd * .35 + sway * .2, K[1] + .4 * length], [K[0] + sd * .3 + sway * .3, K[1] + 1.0 * length]];
      const pts = sample(line, 40, { closed: false }).map(p => [p.x, p.y]);
      const wf = t => .34 * Math.sin(Math.PI * Math.pow(t, .7)) * (1 - .15 * t) + .03 * (1 - t);
      out.push({ pts: taper(pts, u => wf(u), { samples: 40 }), knot: K });
      const tip = pts[pts.length - 1], pre = pts[pts.length - 6], d = unit(tip[0] - pre[0], tip[1] - pre[1]), nn = [-d[1], d[0]];
      for (const k of [-1, 1]) out.push({ pts: taper([[pre[0] + nn[0] * k * .04, pre[1] + nn[1] * k * .04], [tip[0] + nn[0] * k * .09 + d[0] * .02, tip[1] + nn[1] * k * .09 + d[1] * .02], [tip[0] + nn[0] * k * .12 + d[0] * .12, tip[1] + nn[1] * k * .12 + d[1] * .12]], hairProfile(.08, .5), { samples: 12 }) });
    }
    return out;
  }
  // ---------- R5: cat ear on the hair ellipse at ±40°, axis 25° outward, base sunk 20 %, outer edge bowed ----------
  function catEar({ height = .45, at = 40, tilt = 25, sink = .2, bow = .25 } = {}, sd = 1, k = 1.1) {
    const a = deg(at) * sd, base = onSkull(a, k), n = unit(Math.sin(a), -Math.cos(a) * RY / RX);
    const t = deg(tilt) * sd, ax = [n[0] * Math.cos(t) - n[1] * Math.sin(t), n[0] * Math.sin(t) + n[1] * Math.cos(t)], px = [-ax[1] * sd, ax[0] * sd]; // px = outward
    const bw = height * .75, P = (u, v) => [base[0] + ax[0] * height * (u - sink) + px[0] * bw * v, base[1] + ax[1] * height * (u - sink) + px[1] * bw * v];
    const outer = [P(0, .5), P(.45, .5 + bow * .6), P(.8, .25), [...P(1.0, .0), 'c'], P(.75, -.22), P(.4, -.45), P(0, -.5)];
    const inner = [P(.18, .3), P(.5, .3), [...P(.86, .0), 'c'], P(.5, -.26), P(.18, -.28)];
    const fur = [-.15, .05, .25].map(v => P(.2, v));
    const cover = [-1, 0, 1].map(k2 => taper([P(.12, k2 * .3 - .1), P(.02, k2 * .36), P(-.1 - Math.abs(k2) * .04, k2 * .42 + (k2 === 0 ? -.02 : 0))], hairProfile(.06, .6), { samples: 10 }));
    return { outer, inner, fur, cover, base: P(0, 0), tip: P(1, 0), ax, px };
  }

  // ---------- body generators (origin = chin, y down) ----------
  // R8 bean torso: top .6H, max .8H at 60 % T, half-circle bottom, sloped shoulders
  function bean(top = .6, max = .8, T = .5, y0 = 0) {
    const r = max / 2; return [[-.1, y0 - .02], [.1, y0 - .02], [top / 2, y0 + .02], [max / 2 - .02, y0 + T * .45], [max / 2, y0 + T * .68], [r * .55, y0 + T + .02], [0, y0 + T + .04], [-r * .55, y0 + T + .02], [-max / 2, y0 + T * .68], [-max / 2 + .02, y0 + T * .45], [-top / 2, y0 + .02]];
  }
  // R9/R12 tube: centre line through points with width w0 → w1, rounded ends
  function tube(pts, w0, w1 = w0, samples = 24) {
    const line = sample(pts, samples, { closed: false, tension: .8 }).map(p => [p.x, p.y]);
    const poly = taper(line, u => lerp(w0, w1, u), { samples });
    // round caps: replace the flat ends by arcs
    const cap = (p, q, w) => { const d = unit(q[0] - p[0], q[1] - p[1]); return [[p[0] - d[0] * w * .45, p[1] - d[1] * w * .45]]; };
    const L = poly.length / 2;
    return [...poly.slice(0, L), ...cap(line[line.length - 1], line[line.length - 2], w1), ...poly.slice(L), ...cap(line[0], line[1], w0)];
  }
  // R10 fist: rounded rect .24 × .22, r .09, thumb bump
  const fist = (x, y, rot = 0, sc = 1) => { const w = .24 * sc, h = .22 * sc, r = .09 * sc; return { pts: place(roundRectPts(-w / 2, -h / 2, w, h, r), x, y, 1, 1, rot), thumb: place(circlePts(-w * .38, -h * .1, .05 * sc, 8), x, y, 1, 1, rot), lines: [-1, 0, 1].map(i => place([[i * w * .22, -h * .05], [i * w * .22, h * .38]], x, y, 1, 1, rot)) }; };

  // ---------- the rig ----------
  function chibi(c, spec, pose) {
    const s = pose.s, sq = pose.squash || 0, sway = pose.hairSway || 0, tl = pose.tilt || 0, inkC = spec.ink || INKC;
    const LO = s * .02, LP = s * .014, LI = s * .008;                                   // R13 line weights
    const skin = spec.skin || '#fde5d3', skinDk = spec.skinShade || mixCol(skin, '#d0704f', .32);
    const H = pts => pts.map(p => Array.isArray(p) ? [p[0] * s, p[1] * s, p[2]] : { ...p, x: p.x * s, y: p.y * s });
    const hair = spec.hair || {}, hc = hair.color || '#6fd3e6', hd = hair.dark || mixCol(hc, '#2a3a8a', .4), hl = hair.light || mixCol(hc, '#ffffff', .6);
    const body = spec.body || {}, top = body.top || {}, bottom = body.bottom || {};
    const heads = body.heads ?? 1.9, T = (heads - 1) * .5, LEG = (heads - 1) * .5, jump = pose.jump || 0;
    const ey = spec.eyes || {}, eyeY = ((ey.y ?? .64) - .5), ew = ey.size ?? .27, eh = ew * (ey.aspect ?? 1.0), eyeTop = eyeY - eh / 2;
    const tc = top.color || '#2b2f4a', tLt = top.light || mixCol(tc, '#ffffff', .25), tDk = top.dark || mixCol(tc, '#000000', .45);
    const crescent = (pts, col, dx = .05, dy = .05, alpha = .38) => [{ pts: H(shift(pts, dx, dy)), color: col, alpha }];
    const tuftShape = (t, fill = hc, dark = hd) => { const pts = t.pts || hairTuft(t.spine, t.w, t.round); return { pts: H(pts), fill, tension: t.pts ? .9 : 1, shade: crescent(pts, dark, .04, .03, .32) }; };
    const G = (shapes, lw = LO) => group(c, shapes, { lw, outline: inkC });

    c.save(); c.translate(pose.x, pose.y + (pose.bob || 0) * s); c.scale(1 + sq * .35, 1 - sq * .35);
    if (jump < .9) { c.save(); c.globalAlpha = .15 * (1 - jump); c.fillStyle = inkC; c.beginPath(); c.ellipse(0, (.5 + T + LEG + .06) * s, .34 * s, .05 * s, 0, 0, TAU); c.fill(); c.restore(); }

    // ---- tail (R4-like brush: thin root, fat middle, pale tip)
    if (spec.tail) {
      const wag = pose.tailWag || 0, sd = spec.tail.side || 1, tcol = spec.tail.color || hc;
      const line = [[sd * .12, .5 + T * .8], [sd * (.4 + wag * .04), .55 + T * .9], [sd * (.62 + wag * .1), .35 + T * .6 + wag * .08], [sd * (.72 + wag * .14), .1 + T * .3 + wag * .18]];
      const pts = sample(line, 40, { closed: false }).map(p => [p.x, p.y]);
      const poly = taper(pts, u => .05 + .17 * Math.sin(Math.PI * Math.pow(u, .8)) * (1 - u * .1), { samples: 40 });
      G([{ pts: H(poly), fill: tcol, shade: crescent(poly, hd, .04, .04) }]);
      const tipPoly = taper(pts.slice(26), u => .17 * Math.sin(.4 + u * 2.2) * (1 - u * .5), { samples: 14 });
      shape(c, H(tipPoly), { fill: spec.tail.inner || mixCol(tcol, '#ffffff', .7), stroke: inkC, lw: LP });
    }

    // ---- hair behind the face: outline mass (R1) + back hair + tails + side locks (R3), ONE group
    const outer = hairOuter({ crown: hair.crown ?? .15, temple: hair.temple ?? .08, lean: hair.bangs?.part ?? -.3 });
    const backList = [];
    if (hair.back?.style === 'ponytail' || hair.back?.style === 'twin') for (const t of tails(hair.back, sway)) backList.push({ pts: H(t.pts), fill: hc, tension: .95, shade: crescent(t.pts, hd, .04, .04, .3), knot: t.knot });
    const bh = backHair(hair.back || {}, sway);
    const hairGroup = [{ pts: H(bh), fill: hc, tension: .9, shade: [{ pts: H([[-1.5, .2], [1.5, .2], [1.5, 2.5], [-1.5, 2.5]]), color: hd, alpha: .35 }] }].concat(backList, [{ pts: H(outer), fill: hc, tension: 1 }], sideLocks(hair.side || {}, sway).map(t => tuftShape(t)));
    G(hairGroup);
    for (const b of backList) if (b.knot && hair.ribbon) shape(c, H(ellipsePts(b.knot[0], b.knot[1], .07, .05, 8)), { fill: hair.ribbon, stroke: inkC, lw: LI });
    // R7 side-lock shadow onto the back hair (lower 30 % of the mass darker)
    c.save(); tracePath(c, H(bh), { tension: .9 }); c.clip(); c.globalAlpha = .18; c.fillStyle = hd; c.fillRect(-s, (.5 + T * .2) * s, 2 * s, 2 * s); c.restore();

    // ---- body (origin = chin)
    c.save(); c.translate(0, .5 * s);
    if (top.kind === 'hoodie') G([{ pts: H([[-.4, .02], [-.42, .16], [-.2, .24], [.2, .24], [.42, .16], [.4, .02], [0, -.06]]), fill: tc, tension: .9, shade: [{ pts: H([[-1, .12], [1, .12], [1, 1], [-1, 1]]), color: '#000', alpha: .35 }] }], LP); // hood bulge behind the neck
    // R12 legs: tapered tubes .22 → .16, jump: front knee up, back leg back, toes down
    const legs = [];
    for (const sd of [-1, 1]) {
      const front = sd === (pose.frontLeg ?? -1), P = [sd * .14, T - .04];
      const K = jump ? (front ? [P[0] + sd * .14 * jump, P[1] + LEG * .5 - .12 * jump] : [P[0] - sd * .06 * jump, P[1] + LEG * .5 - .02 * jump]) : [P[0], P[1] + LEG * .5];
      const A = jump ? (front ? [K[0] + sd * .02, K[1] + LEG * .5 * (1 - .35 * jump)] : [K[0] - sd * .1 * jump, K[1] + LEG * .5 * (1 - .15 * jump)]) : [P[0] + sd * .01, P[1] + LEG];
      const col = bottom.kind === 'jeans' ? (bottom.color || '#7fa6c9') : (bottom.socks || skin), dk = mixCol(col, '#1a1a30', .35);
      const poly = tube([P, K, A], .22, .16);
      const d = unit(A[0] - K[0], A[1] - K[1]), toe = unit(d[0] + sd * .9 * (jump ? .4 : 1) + (jump ? sd * .3 : 0), d[1] + (jump ? .9 : .2));
      const shoePts = tube([[A[0] - toe[0] * .03, A[1] - toe[1] * .03 + .01], [A[0] + toe[0] * .16, A[1] + toe[1] * .16 + .01]], .12, .13, 10);
      legs.push({ poly, shoePts, A, K, P, col, dk, d, toe, sd });
    }
    for (const L of legs) {
      G([{ pts: H(L.poly), fill: L.col, shade: crescent(L.poly, L.dk, .035, 0) }]);
      if (bottom.kind === 'jeans' && bottom.ripped) { const rp = [[L.K[0] - .08, L.K[1] - .01], [L.K[0] - .02, L.K[1] - .035], [L.K[0] + .03, L.K[1] - .015], [L.K[0] + .08, L.K[1] - .03], [L.K[0] + .07, L.K[1] + .035], [L.K[0], L.K[1] + .02], [L.K[0] - .06, L.K[1] + .04]]; shape(c, H(rp), { fill: skin, stroke: inkC, lw: LI, tension: .5 }); }
      if (bottom.kind !== 'jeans' && bottom.socks) { ink(c, H([[L.P[0] - .12, L.P[1] + .08], [L.P[0], L.P[1] + .06], [L.P[0] + .12, L.P[1] + .08]]), LP, mixCol(L.col, '#ffffff', .3), 'none'); }
      const sh = bottom.shoes || '#e9e9ef', sole = [{ pts: H(L.shoePts), fill: sh, shade: crescent(L.shoePts, mixCol(sh, '#000000', .35), .0, .04) }];
      G(sole, LP);
      const n = [-L.toe[1], L.toe[0]]; ink(c, H([[L.A[0] - L.toe[0] * .03 + n[0] * .07, L.A[1] - L.toe[1] * .03 + n[1] * .07 + .02], [L.A[0] + L.toe[0] * .2 + n[0] * .07, L.A[1] + L.toe[1] * .2 + n[1] * .07 + .02]]), LP, bottom.sole || mixCol(sh, '#000000', .3), 'none'); // sole line
    }
    // R11 pleated skirt
    if (bottom.kind === 'skirt') {
      const kc = bottom.color || '#2e3b52', y0 = T * .62, y1 = T + .06, sk = [[-.35, y0 + .02], [0, y0 - .02], [.35, y0 + .02], [.55, y1 - .02]];
      const n = 6; for (let i = 0; i <= n; i++) { const u = i / n, x = lerp(.55, -.55, u); sk.push([x, y1 + (i % 2 ? .04 : 0) + Math.sin(u * Math.PI) * .01, 'c']); }
      sk.push([-.55, y1 - .02]);
      const valleys = []; for (let i = 1; i < n; i += 2) valleys.push([lerp(.55, -.55, i / n) * .9, y0 + .06, lerp(.55, -.55, i / n), y1]);
      G([{ pts: H(sk), fill: kc, tension: .5, shade: [{ pts: H([[.1, 0], [.8, 0], [.8, 1], [.2, 1]]), color: '#101522', alpha: .35 }] }]);
      for (const v of valleys) ink(c, H([[v[0], v[1]], [v[2], v[3]]]), LI, 'rgba(10,15,30,.5)', 'inout');
    }
    // R8 torso bean (sweater under a jacket, or the hoodie / sweater itself)
    if (top.kind === 'jacket') {
      const swc = top.inner || '#8a8f9c', tp = bean(.5, .62, T * .95, -.02);
      G([{ pts: H(tp), fill: swc, tension: .8, shade: crescent(tp, mixCol(swc, '#000000', .3), .06, 0) }]);
      for (let i = -2; i <= 2; i++) ink(c, H([[i * .06, .1], [i * .065, T * .85]]), LI, 'rgba(20,20,30,.3)', 'inout');
    } else {
      const tp = bean(.62, .84, T, -.02);
      const rib = [[-.33, T - .04], [0, T + .0], [.33, T - .04], [.31, T + .03], [0, T + .07], [-.31, T + .03]];
      G([{ pts: H(tp), fill: tc, tension: .8, shade: crescent(tp, tDk, .07, .02) }, { pts: H(rib), fill: tLt, tension: .6 }]);
      for (let i = -3; i <= 3; i++) ink(c, H([[i * .1, T - .01 + Math.abs(i) * .003], [i * .1, T + .06]]), LI, 'rgba(0,0,0,.25)', 'none');
      if (top.kind === 'hoodie') { G([{ pts: H([[-.25, T * .55], [.25, T * .55], [.3, T - .04], [-.3, T - .04]]), fill: tc, tension: .3, shade: crescent([[-.25, T * .55], [.25, T * .55], [.3, T - .04], [-.3, T - .04]], tDk, .0, .04) }], LI); ink(c, H([[0, .02], [0, T * .55]]), LI * 1.4, top.zip || '#c9cbd6', 'none'); for (const sd of [-1, 1]) { ink(c, H([[sd * .08, .02], [sd * .1, T * .3], [sd * .07, T * .5]]), LI, top.string || '#e8e8ee', 'none'); shape(c, H(circlePts(sd * .07, T * .52, .018, 8)), { fill: top.string || '#e8e8ee' }); } }
    }
    // R9/R10 arms: one tapered tube S → E → W; a 0 hanging .. 1 fists beside the head (temple height, never above the crown)
    const raised = [], armW = (top.kind === 'sweater' ? 1 : 1.2) * .16, cuffW = armW * 1.35;
    const arm = (sd, a, asym) => {
      const S = [sd * .3, .05 * T / .5], E0 = [sd * .34, .5 * T / .5 * .5 + .12], W0 = [sd * .36, 1.0 * T / .5 * .5];
      const E1 = [sd * .62, -.1 * T / .5 * .5 - .06], W1 = [sd * (.64 + asym), -.55 * T / .5 * .5 - .2];   // fists beside the head, outside the hair outline
      const k = clamp(a), E = [lerp(E0[0], E1[0], k), lerp(E0[1], E1[1], k)], W = [lerp(W0[0], W1[0], k), lerp(W0[1], W1[1], k)];
      const poly = tube([S, E, W], armW, cuffW, 26);
      G([{ pts: H(poly), fill: tc, shade: crescent(poly, tDk, .05, .02) }], LP);
      const d = unit(W[0] - E[0], W[1] - E[1]), n = [-d[1], d[0]];
      // cuff: S-curved edge + one slack line (R10)
      ink(c, H([[W[0] + n[0] * cuffW * .45, W[1] + n[1] * cuffW * .45], [W[0] + d[0] * .03, W[1] + d[1] * .03], [W[0] - n[0] * cuffW * .45 - d[0] * .03, W[1] - n[1] * cuffW * .45 - d[1] * .03]]), LI * 1.3, mixCol(tc, '#000000', .35), 'inout');
      ink(c, H([[W[0] - d[0] * .12 + n[0] * cuffW * .2, W[1] - d[1] * .12 + n[1] * cuffW * .2], [W[0] - d[0] * .05 - n[0] * cuffW * .15, W[1] - d[1] * .05 - n[1] * cuffW * .15]]), LI, 'rgba(255,255,255,.18)', 'inout');
      if (k > .6 && Math.abs(E[1] - S[1]) > .05) ink(c, H([[S[0] + sd * .03, S[1] + .06], [S[0] + sd * .09, S[1] + .16]]), LI, 'rgba(0,0,0,.3)', 'inout'); // armpit fold
      if (sd === 1 && top.badge) shape(c, H(roundRectPts(E[0] * .55 + .02, E[1] * .5 + .02, .09, .08, .015)), { fill: '#e8e8ec', stroke: inkC, lw: LI });
      if (k > .3 || pose.fists) { const f = fist(W[0] + d[0] * .1, W[1] + d[1] * .1, Math.atan2(d[1], d[0]) - Math.PI / 2 + sd * .25, 1);
        G([{ pts: H(f.pts), fill: skin, shade: crescent(f.pts, skinDk, .03, .03) }, { pts: H(f.thumb), fill: skin }], LP); for (const l of f.lines) ink(c, H(l), LI * .8, mixCol(skin, '#a05a40', .5), 'inout');
        // cuff lip over the lower half of the fist (萌え袖)
        const lip = tube([[W[0] - d[0] * .06, W[1] - d[1] * .06], [W[0] + d[0] * .04, W[1] + d[1] * .04]], cuffW, cuffW * .95, 8); G([{ pts: H(lip), fill: tc, shade: crescent(lip, tDk, .04, .02) }], LP); }
    };
    for (const [sd, a] of [[-1, pose.armL || 0], [1, pose.armR || 0]]) { if (a > .6) raised.push([sd, a]); else arm(sd, a, sd < 0 ? .0 : .04); }
    if (top.kind === 'jacket') for (const sd of [-1, 1]) {
      const front = [[sd * .05, -.04], [sd * .3, -.04], [sd * .42, T * .35], [sd * .4, T * .95, 'c'], [sd * .3, T + .04], [sd * .14, T], [sd * .09, T * .3]];
      G([{ pts: H(front), fill: tc, tension: .8, shade: crescent(front, tDk, .06, .02), light: [{ pts: H([[sd * .05, -.1], [sd * .11, -.1], [sd * .15, 1], [sd * .09, 1]]), color: tLt, alpha: .5 }] }], LP);
    }
    c.restore(); // body

    // ---- head (pivot at the neck)
    c.save(); c.translate(0, .5 * s); c.rotate(tl); c.translate(0, -.5 * s);
    const facePts = head(spec.head || {}), bangList = bangs({ ...(hair.bangs || {}), tipY: hair.bangs?.tipY ?? (eyeTop - .03) }, sway), bangPolys = bangList.map(t => hairTuft(t.spine, t.w, t.round));
    G([{ pts: H([[-.12, .3], [.12, .3], [.14, .55], [-.14, .55]]), fill: skin, shade: [{ pts: H([[-.2, .3], [.2, .3], [.2, .55], [-.2, .55]]), color: skinDk, alpha: .5 }] },
      { pts: H(facePts), fill: skin, shade: bangPolys.map(p => ({ pts: H(shift(p, .0, .045)), color: skinDk, alpha: .3 })) }]);
    const bl = pose.blush ?? 0; if (bl > 0) for (const sd of [-1, 1]) blush(c, sd * .31 * s, (eyeY + eh * .62) * s, .09 * s, spec.blushColor || '#f39a8f', .45 * bl, spec.blushLines !== false);
    for (const sd of [-1, 1]) {
      c.save(); c.translate(sd * (ey.spacing ?? .23) * s, eyeY * s); c.rotate(-sd * (ey.tilt || 0));
      const st = Array.isArray(pose.eyes) ? pose.eyes[sd < 0 ? 0 : 1] : (pose.eyes || 'round');
      const op = Array.isArray(pose.eyeOpen) ? pose.eyeOpen[sd < 0 ? 0 : 1] : (pose.eyeOpen ?? 1);
      animeEye(c, ew * s, eh * s, { style: st, open: op, iris: ey.iris || '#3ec7c0', look: pose.look, side: sd, ink: inkC, lash: ey.lash ?? .7, brow: pose.brow ? { y: pose.brow.y ?? .55, angle: pose.brow.angle || 0, w: 1.6, color: hd } : null });
      c.restore();
    }
    const mo = spec.mouth || {}, mk = pose.mouth || 'smile';
    c.save(); c.translate((mo.x || 0) * s, ((mo.y ?? .84) - .5) * s);
    mouth(c, pose.mouthPts || mouthPts(mk), (mo.width ?? .12) * s, { fang: pose.fang, teeth: pose.teeth ?? (mk === 'yell' ? 'zig' : false), ink: inkC });
    c.restore();
    // ---- crown piece + bangs (R2) in one group so no seam shows; then the angel ring (R7)
    const crownPts = outer.filter(p => p[1] < eyeTop - .05).concat([[RX * 1.1, eyeTop - .02], [0, eyeTop + .0], [-RX * 1.1, eyeTop - .02]]);
    const crownShape = { pts: H(crownPts), fill: hc, tension: .9 };
    const hatBrimY = spec.hat ? eyeTop - 1.1 * eh + (spec.hat.y ?? 0) : null;
    G([crownShape].concat(bangList.map((t, i) => ({ pts: H(bangPolys[i]), fill: hc, shade: t.sub ? [] : crescent(bangPolys[i], hd, .04, .03, .3) }))));
    if (hair.highlight !== false && !spec.hat) {
      const ringY = -RY * 1.15 + .3 * ((eyeTop - .3) + RY * 1.15), zz = [], n = 8;
      for (let i = 0; i <= n; i++) { const u = i / n, x = lerp(-.7, .7, u) * RX, y = ringY + (x * x) * .5; zz.push([x, y - .02 - (i % 2 ? .015 : 0), 'c']); }
      for (let i = n; i >= 0; i--) { const u = i / n, x = lerp(-.7, .7, u) * RX, y = ringY + (x * x) * .5; zz.push([x, y + .03 + (i % 2 ? .008 : 0) + (Math.abs(u - .5) > .4 ? .02 : 0), 'c']); }
      c.save(); c.beginPath(); tracePath(c, H(crownPts), { raw: true, tension: .9 }); for (const p of bangPolys) tracePath(c, H(p), { raw: true }); c.clip();
      shape(c, H(zz), { fill: mixCol(hc, hl, .7), alpha: .55, tension: .4 }); c.restore();
    }
    for (const st of hair.streaks || []) ink(c, H(st.spine), s * st.w, st.color || hd, 'inout');
    // ---- R6 cap
    if (spec.hat && spec.hat.kind === 'cap') {
      const hcol = spec.hat.color || '#222228', bc = spec.hat.brim || '#c2323c', brimY = hatBrimY, sag = .06;
      const crown = []; for (let i = 0; i <= 16; i++) { const a = Math.PI + i / 16 * Math.PI; crown.push([Math.cos(a) * RX * 1.18, -.03 + Math.sin(a) * RY * 1.2]); }
      for (let i = 4; i >= -4; i--) { const x = i / 4 * RX * 1.18; crown.push([x, brimY + sag * (x / RX) * (x / RX) + .02]); }
      const brim = []; for (let i = -6; i <= 6; i++) { const x = i / 6 * RX * 1.02; brim.push([x, brimY + sag * (x / RX) * (x / RX)]); }
      for (let i = 6; i >= -6; i--) { const u = i / 6, x = u * RX * 1.02; brim.push([x, brimY + sag * u * u + .11 * (1 - u * u) + .01]); }
      c.save(); tracePath(c, H(facePts)); c.clip(); shape(c, H(shift(brim, 0, .05)), { fill: skinDk, alpha: .22, tension: .5 }); c.restore();
      G([{ pts: H(shift(brim, 0, .03)), fill: mixCol(bc, '#000000', .45), tension: .5 }], LP);                         // thickness band
      G([{ pts: H(crown), fill: hcol, tension: .7, shade: crescent(crown, '#000', .07, .04, .35), light: [{ pts: H([[-.45, -.75], [-.15, -.85], [-.1, -.5], [-.4, -.4]]), color: '#55555f', alpha: .35 }] },
        { pts: H(brim), fill: bc, tension: .5, shade: [{ pts: H([[-1, brimY + .06], [1, brimY + .06], [1, 1], [-1, 1]]), color: '#000', alpha: .25 }] }]);
      for (const x of [-.2, .2]) ink(c, H([[x * .4, -.03 - RY * 1.15], [x, brimY - .02]]), LI, 'rgba(0,0,0,.4)', 'inout');
      shape(c, H(circlePts(0, -.03 - RY * 1.2, .025, 8)), { fill: hcol, stroke: inkC, lw: LI });
    }
    // ---- ahoge
    if (hair.ahoge) { const ah = hair.ahoge === true ? {} : hair.ahoge, kind = ah.kind || 'loop', x0 = ah.x ?? -.05, y0 = -RY * 1.15 + .04;
      const sp = kind === 'loop' ? [[x0 - .03, y0], [x0 - .1 + sway * .03, y0 - .2], [x0 + .02 + sway * .06, y0 - .3, 'c'], [x0 + .12 + sway * .03, y0 - .18], [x0 + .05, y0]] : [[x0, y0], [x0 + .06 + sway * .05, y0 - .18], [x0 + .2 + sway * .1, y0 - .3]];
      G([{ pts: H(taper(sp, u => .06 * (1 - u * .5), { samples: 24 })), fill: hc }], LP); }
    // ---- R5 ears (base sunk into the hair / cap, covered by small tufts)
    if (spec.ears) for (const sd of [-1, 1]) {
      const e = catEar({ ...spec.ears, tilt: (spec.ears.tilt ?? 25) + (pose.earTwitch || 0) * 15 + sway * 5 }, sd, spec.hat ? 1.18 : 1.1);
      if (spec.hat) shape(c, H(ellipsePts(e.base[0], e.base[1], .12, .05, 10, Math.atan2(e.px[1], e.px[0]))), { fill: '#000', alpha: .6 });
      G([{ pts: H(e.outer), fill: spec.ears.color || hc, tension: .95, shade: crescent(e.outer, hd, .05, .04) },
        { pts: H(e.inner), fill: spec.ears.inner || '#f3f0ee', tension: .95, shade: crescent(e.inner, '#c9c3c0', .03, .03) }]);
      for (const f of e.fur) shape(c, H(circlePts(f[0], f[1], .035, 8)), { fill: '#ffffff', alpha: .95 });
    }
    if (spec.hairclip) { const sd = spec.hairclip.side || -1; c.save(); c.translate(sd * .34 * s, -.1 * s); c.rotate(sd * .5); shape(c, H(roundRectPts(-.06, -.02, .12, .04, .01)), { fill: spec.hairclip.color || '#e9e9ef', stroke: inkC, lw: LI }); c.restore(); }
    c.restore(); // head

    // ---- collar AFTER the head: the chin sinks into it (R11)
    c.save(); c.translate(0, .5 * s);
    if (top.kind === 'jacket') {
      const swc = top.inner || '#8a8f9c', col = ellipsePts(0, .01, .31, .07, 14);
      G([{ pts: H(col), fill: swc, tension: 1, shade: crescent(col, mixCol(swc, '#000000', .35), .0, .05, .5) }], LI);
      ink(c, H([[-.26, .0], [0, -.05], [.26, .0]]), LI, 'rgba(20,20,30,.35)', 'inout');
      for (let i = -3; i <= 3; i++) ink(c, H([[i * .08, -.06 + Math.abs(i) * .008], [i * .082, .04 - Math.abs(i) * .008]]), LI, 'rgba(20,20,30,.3)', 'inout');
    } else if (top.kind === 'hoodie') { const rim = [[-.32, -.06], [0, .02], [.32, -.06], [.32, .04], [0, .12], [-.32, .04]]; G([{ pts: H(rim), fill: tLt, tension: .8, shade: crescent(rim, tDk, .0, .05) }], LP); }
    else G([{ pts: H([[-.2, -.06], [.2, -.06], [.22, .04], [0, .1], [-.22, .04]]), fill: tLt }], LP);
    for (const [sd, a] of raised) arm(sd, a, sd < 0 ? .0 : .04);
    c.restore();
    if (pose.emote) { c.save(); c.translate(0, .5 * s); c.rotate(tl); c.translate(0, -.5 * s); emote(c, pose.emote.kind, (pose.emote.x ?? .55) * s, (pose.emote.y ?? -.55) * s, (pose.emote.s ?? .16) * s, pose.emote.age ?? 1, pose.emote.color); c.restore(); }
    c.restore();
  }

  Object.assign(window, { chibi, PARTS: { head, hairOuter, bangs, sideLocks, backHair, tails, catEar, bean, tube, fist, hairTuft, hairProfile, tuftSpine, onSkull } });
})();
