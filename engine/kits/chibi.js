// chibi.js: a formula-driven chibi (SD) character rig on top of vector.js. Load after vector.js.
//
//   chibi(c, spec, pose)      draw one character. spec = ratios + colours (who), pose = expression / limbs / motion (now).
//   PARTS.head / bangs / sideLocks / backHair / ear / torso / capsule ...   the generators, usable on their own.
//
// No hand-placed coordinates: every part is generated from a few ratios (engine/VECTOR_GUIDE.md). Units: pose.s = head
// width in px; local origin = head centre; y down; the head box spans y -.5 .. +.5 (face fraction f → y = f - .5).
// The hair is ONE soft ellipse (skull × (1 + volume)) with tufts hanging off it; nothing has a straight edge.
(() => {
  'use strict';
  const INKC = '#1c1a22';
  const R = (seed) => { const r = rng(seed * 7919 + 13); return () => r(); };
  const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  const shift = (pts, dx, dy) => pts.map(p => Array.isArray(p) ? [p[0] + dx, p[1] + dy, p[2]] : { ...p, x: p.x + dx, y: p.y + dy });

  // ---------- head outline: "mochi" (round top, cheeks at `cheek`, wide rounded chin) ----------
  function head({ w = 1, h = 1, cheek = .6, chin = .2, jaw = .7 } = {}) {
    const pts = [], n = 18;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU - Math.PI / 2, cx = Math.cos(a), sy = Math.sin(a), f = (sy + 1) / 2;
      let xr = 1;
      if (f > cheek) { const k = (f - cheek) / (1 - cheek); xr = 1 - (1 - jaw) * Math.pow(k, 1.8) - chin * .15 * k * k * k; }
      else { const k = 1 - f / cheek; xr = 1 - .05 * k * k; }
      pts.push({ x: cx * xr * w / 2, y: (sy * .5 + (f > cheek ? chin * .03 * (f - cheek) : 0)) * h });
    }
    return pts;
  }
  // The hair mass: an ellipse slightly wider than tall around the skull, centre a little above the head centre.
  const hairMass = (vol) => ellipsePts(0, -.06, .5 + vol, .5 + vol * .8, 24);

  // ---------- hair tufts ----------
  function tuftSpine(bx, by, dir, len, curl, wob = 0) {
    const nx = -dir[1], ny = dir[0];
    return [[bx, by], [bx + dir[0] * len * .5 + nx * wob * len, by + dir[1] * len * .5 + ny * wob * len], [bx + dir[0] * len + nx * curl * len * .5, by + dir[1] * len + ny * curl * len * .5]];
  }
  // wide for most of the length, then a rounded taper to a soft point
  const hairProfile = (w, round = .45) => u => w * (u < 1 - round ? 1 - u * .1 : (1 - .1 * (1 - round)) * Math.pow(Math.cos((u - (1 - round)) / round * Math.PI / 2), .8));
  const hairTuft = (spine, w, round) => taper(spine, hairProfile(w, round), { samples: 28 });

  // Bangs: n tufts of mixed widths sweeping toward `part`, roots inside the hair mass, tips at hairline + length.
  function bangs({ n = 5, part = -.3, hairline = .3, length = .17, lengthVar = .12, widthVar = .35, curl = .25, seed = 1, spread = 1.0, fan = .3 } = {}, sway = 0) {
    const rnd = R(seed), out = [], y0 = hairline - .5;
    const widths = Array.from({ length: n }, (_, i) => 1 + (rnd() - .5) * 2 * widthVar + (i % 2 ? .25 : -.25)); // alternate big / small
    const tot = widths.reduce((a, b) => a + b, 0); let acc = 0;
    for (let i = 0; i < n; i++) {
      const u = (acc + widths[i] / 2) / tot; acc += widths[i];
      const bx = (u - .5) * spread, cur = Math.cos(Math.asin(clamp(bx / .6, -1, 1)));
      const root = y0 - .2 - (1 - cur) * .1;
      const dir = unit((bx - part * .2) * fan, 1);
      const tipY = y0 + length * (1 + (rnd() - .5) * 2 * lengthVar) + (1 - cur) * .05;
      const L = (tipY - root) / dir[1];
      const w = (spread / tot) * widths[i] * 1.25;
      const cdir = bx < part * .2 ? -1 : 1;                          // tips curl away from the parting (a sweep)
      const spine = tuftSpine(bx, root, dir, L, curl * cdir * .6 + sway * .4, (rnd() - .5) * .06 + sway * .2);
      out.push({ spine, w, round: .5, order: Math.abs(u - .5) });
    }
    return out.sort((a, b) => b.order - a.order);
  }
  // Side locks: hang from the 4 / 8 o'clock of the hair ellipse, taper to a tip that flicks outward.
  function sideLocks({ n = 2, length = .9, width = .24, curl = .2, seed = 2 } = {}, sway = 0, vol = .1) {
    const rnd = R(seed), out = [];
    for (const sd of [-1, 1]) for (let i = 0; i < n; i++) {
      const k = i / Math.max(1, n - 1), a = Math.PI * (.22 + k * .1), bx = sd * Math.cos(a) * (.5 + vol) * .98, by = -.06 + Math.sin(a) * (.5 + vol * .8) * .9;
      const L = length * (1 - k * .3) * (1 + (rnd() - .5) * .2);
      const spine = tuftSpine(bx, by - .15, unit(sd * .05, 1), L + .15, curl * sd + sway * .6 * (1 + k), sway * .3 - sd * .05);
      out.push({ spine, w: width * (1 - k * .3), round: .6 });
    }
    return out;
  }
  // Back hair: 'bob' (mass to the chin), 'long' (to the waist, tapered ends); 'ponytail' / 'twin' bundles (one big S + one small).
  function backHair({ style = 'bob', length = .6, volume = .1, ends = 5, seed = 3, side = 1 } = {}, sway = 0) {
    const rnd = R(seed), out = [];
    if (style === 'long') {
      const L = .8 + length * .6, hw = .42 + volume;
      const pts = [[-hw, -.1], [-hw - .02, .2], [-hw * .9, .5 + L * .3], [-hw * .75, .5 + L * .5]];
      for (let i = 0; i <= ends; i++) { const u = i / ends; pts.push([lerp(-hw * .75, hw * .75, u), .5 + L * .5 + (i % 2 ? .07 : -.02) * (1 + rnd()) + Math.sin(u * Math.PI) * L * .1]); }
      pts.push([hw * .75, .5 + L * .5], [hw * .9, .5 + L * .3], [hw + .02, .2], [hw, -.1], [0, -.35]);
      out.push({ pts: pts.map(([x, y]) => [x + sway * .25 * Math.max(0, y + .2), y]) });
    }
    if (style === 'ponytail' || style === 'twin') {
      const knots = style === 'twin' ? [[-.5, -.15], [.5, -.15]] : [[side * .46, -.34]];
      for (const [kx, ky] of knots) { const sd = Math.sign(kx) || 1;
        out.push({ spine: [[kx, ky], [kx + sd * .28, ky + .1 + sway * .1], [kx + sd * .34 + sway * .15, ky + .45 + length * .3], [kx + sd * .2 + sway * .25, ky + .7 + length * .5]], w: .3, round: .55, knot: [kx, ky] });
        out.push({ spine: [[kx, ky + .05], [kx + sd * .3, ky + .3], [kx + sd * .42 + sway * .1, ky + .4 + length * .25]], w: .17, round: .55 });
      }
    }
    return out;
  }
  // Cat ear at clock position `at` (rad from straight up, outward), tilted `tilt` further outward; base sunk into the hair.
  function catEar({ size = .5, at = .78, tilt = .3, width = .3, bow = .1 } = {}, sd = 1, vol = .1) {
    const rx = .5 + vol, ry = .5 + vol * .8;
    const cx = Math.sin(at) * rx * sd, cy = -.06 - Math.cos(at) * ry;
    const dir = unit(Math.sin(at + tilt) * sd, -Math.cos(at + tilt)), nx = -dir[1] * sd, ny = dir[0] * sd; // (nx, ny) = outward
    const P = (t, u) => [cx + dir[0] * size * (t - .22) + nx * width * u, cy + dir[1] * size * (t - .22) + ny * width * u];
    const outer = [P(0, .5), P(.4, .5 + bow), P(.78, .27), [...P(1.0, 0), 'c'], P(.72, -.27), P(.35, -.46), P(0, -.5)];
    const inner = [P(.28, .22), P(.5, .24), [...P(.82, .0), 'c'], P(.5, -.19), P(.28, -.2)];
    const fluff = [[.08, .1], [.1, -.12]].map(([t, u]) => taper([P(t + .1, u * 1.3), P(t + .22, u), P(t + .32, u * .7)], hairProfile(.05, .6), { samples: 12 }));
    return { outer, inner, fluff, tip: P(1, 0), base: [cx, cy], dir };
  }

  // ---------- body generators (local origin = chin, y down) ----------
  // Pear torso with big rounded corners: shoulders sw, hips hw, height h.
  const torso = (sw, hw, h, y0 = -.02) => { const r = hw * .2; return [[-sw / 2 + r * .5, y0], [sw / 2 - r * .5, y0], [sw / 2 + .01, y0 + r], [hw / 2, y0 + h - r], [hw / 2 - r, y0 + h], [-hw / 2 + r, y0 + h], [-hw / 2, y0 + h - r], [-sw / 2 - .01, y0 + r]]; };
  // Capsule along a direction with different end widths (sleeves, legs); ends are rounded.
  function capsule(x0, y0, x1, y1, w0, w1 = w0) {
    const d = unit(x1 - x0, y1 - y0), n = [-d[1], d[0]];
    const E = (x, y, w, s) => [[x + n[0] * w / 2, y + n[1] * w / 2], [x + n[0] * w * .36 + d[0] * w * .42 * s, y + n[1] * w * .36 + d[1] * w * .42 * s], [x - n[0] * w * .36 + d[0] * w * .42 * s, y - n[1] * w * .36 + d[1] * w * .42 * s], [x - n[0] * w / 2, y - n[1] * w / 2]];
    const a = E(x0, y0, w0, -1), b = E(x1, y1, w1, 1);
    return [a[0], b[0], b[1], b[2], b[3], a[3], a[2], a[1]];
  }
  // Fist: rounded square with three finger lines. Returns { pts, lines }.
  const fist = (x, y, r) => ({ pts: roundRectPts(x - r, y - r * .9, r * 2, r * 1.8, r * .6), lines: [0, 1, 2].map(i => [[x - r * .55 + i * r * .55, y - r * .05], [x - r * .55 + i * r * .55, y + r * .55]]) });

  // ---------- the rig ----------
  function chibi(c, spec, pose) {
    const s = pose.s, sq = pose.squash || 0, sway = pose.hairSway || 0, tl = pose.tilt || 0, inkC = spec.ink || INKC;
    const lw = s * (spec.lineWidth ?? .024), lwi = lw * .45, skin = spec.skin || '#fde5d3', skinDk = spec.skinShade || mixCol(skin, '#d0704f', .32);
    const H = pts => pts.map(p => Array.isArray(p) ? [p[0] * s, p[1] * s, p[2]] : { ...p, x: p.x * s, y: p.y * s });
    const hair = spec.hair || {}, hc = hair.color || '#6fd3e6', hd = hair.dark || mixCol(hc, '#2a3a8a', .4), hl = hair.light || mixCol(hc, '#ffffff', .6);
    const vol = hair.volume ?? .1, hd2 = spec.head || {}, body = spec.body || {}, top = body.top || {}, bottom = body.bottom || {};
    const heads = body.heads ?? 1.9, bodyH = heads - 1, jump = pose.jump || 0;
    // crescent shade: the same shape shifted toward the light's opposite side (down-right), clipped by group()
    const crescent = (pts, col, k = 1, dx = .05, dy = .05) => [{ pts: H(shift(pts, dx * k, dy * k)), color: col, alpha: .38 }];
    const tuftShape = (t, fill, dark) => { const pts = t.pts || hairTuft(t.spine, t.w, t.round); return { pts: H(pts), fill, tension: t.pts ? .85 : 1, shade: crescent(pts, dark, 1, .045, .03) }; };

    c.save(); c.translate(pose.x, pose.y + (pose.bob || 0) * s); c.scale(1 + sq * .35, 1 - sq * .35);
    // ground shadow
    if (jump < .9) { c.save(); c.globalAlpha = .15 * (1 - jump); c.fillStyle = inkC; c.beginPath(); c.ellipse(0, (.5 + bodyH + .04) * s, .36 * s, .05 * s, 0, 0, TAU); c.fill(); c.restore(); }

    // tail: brush shape (thin root, fat middle, fluffy pale tip)
    if (spec.tail) {
      const wag = pose.tailWag || 0, sd = spec.tail.side || 1, tc = spec.tail.color || hc;
      const spine = [[sd * .14, .3 + bodyH * .55], [sd * (.38 + wag * .04), .32 + bodyH * .6 + wag * .04], [sd * (.6 + wag * .1), .2 + bodyH * .45 + wag * .1], [sd * (.7 + wag * .14), -.02 + bodyH * .3 + wag * .18]];
      const poly = taper(spine, u => .06 + .16 * Math.sin(Math.PI * Math.pow(u, .8)) * (1 - u * .2) + .02 * (1 - u), { samples: 40 });
      group(c, [{ pts: H(poly), fill: tc, shade: crescent(poly, hd, 1, .04, .04) }], { lw, outline: inkC });
      const tipPoly = taper(spine.slice(2), u => .17 * (1 - u * .6) * Math.sin(.3 + u * 2.4), { samples: 16 });
      shape(c, H(tipPoly), { fill: spec.tail.inner || mixCol(tc, '#ffffff', .7), stroke: inkC, lw });
    }
    // hair: the mass ellipse + back styles + side locks (all behind the face)
    const mass = hairMass(vol), backSpec = hair.back || { style: 'bob' }, backList = backHair(backSpec, sway);
    const backShapes = [{ pts: H(mass), fill: hc, tension: 1, shade: [{ pts: H([[-1.5, .1], [1.5, .1], [1.5, 2], [-1.5, 2]]), color: hd, alpha: .35 }] }].concat(backList.map(t => tuftShape(t, hc, hd)));
    if (top.kind === 'hoodie') group(c, [{ pts: H([[-.36, .3], [-.38, .52], [-.2, .62], [.2, .62], [.38, .52], [.36, .3], [0, .22]]), fill: top.color || '#1d1d24', shade: [{ pts: H([[-1, .45], [1, .45], [1, 1], [-1, 1]]), color: '#000', alpha: .35 }] }], { lw, outline: inkC });
    group(c, backShapes.concat(sideLocks(hair.side || {}, sway, vol).map(t => tuftShape(t, hc, hd))), { lw, outline: inkC });
    for (const b of backList) if (b.knot && hair.ribbon) shape(c, H(ellipsePts(b.knot[0], b.knot[1], .07, .05, 8)), { fill: hair.ribbon, stroke: inkC, lw: lwi });

    // ---- body (origin at the chin)
    c.save(); c.translate(0, .46 * s);
    const tw = body.torsoWidth ?? .6, torsoH = bodyH * .55, legH = bodyH * .45, legW = body.legWidth ?? .17, legGap = body.legGap ?? .15;
    const tc = top.color || '#2b2f4a', tLt = top.light || mixCol(tc, '#ffffff', .25), tDk = top.dark || mixCol(tc, '#000000', .45);
    // legs: thigh + shin capsules; bend = knee lift (0 straight .. 1 knee up), kick = swing back
    for (const sd of [-1, 1]) {
      const bend = (sd < 0 ? pose.legL : pose.legR) ?? (jump ? (sd < 0 ? .8 : .25) * jump : 0);
      const lx = sd * legGap, hip = torsoH - .08, thighL = legH * .5, shinL = legH * .5;
      const a1 = sd * bend * 1.1, kx = lx + Math.sin(a1) * thighL, ky = hip + Math.cos(a1) * thighL;   // knee
      const a2 = a1 - sd * bend * 1.6, fx = kx + Math.sin(a2) * shinL, fy = ky + Math.cos(a2) * shinL;  // ankle
      const legCol = bottom.kind === 'jeans' ? (bottom.color || '#7fa6c9') : (bottom.socks || skin), legDk = mixCol(legCol, '#1a1a30', .35);
      const thigh = capsule(lx, hip, kx, ky, legW * 1.05, legW * .95), shin = capsule(kx, ky, fx, fy, legW * .95, legW * .85);
      group(c, [{ pts: H(thigh), fill: legCol, shade: crescent(thigh, legDk, 1, .04, 0) }, { pts: H(shin), fill: legCol, shade: crescent(shin, legDk, 1, .04, 0) }], { lw, outline: inkC });
      if (bottom.kind === 'jeans' && bottom.ripped) { const rp = [[kx - legW * .38, ky - .01], [kx - legW * .1, ky - .035], [kx + legW * .15, ky - .015], [kx + legW * .4, ky - .03], [kx + legW * .32, ky + .035], [kx, ky + .02], [kx - legW * .3, ky + .04]]; shape(c, H(rp), { fill: skin, stroke: inkC, lw: lwi, tension: .5 }); for (let i = 0; i < 2; i++) ink(c, H([[kx - legW * .3, ky - .02 + i * .03], [kx + legW * .3, ky - .02 + i * .03]]), lwi * .6, '#eef2ff', 'inout'); }
      if (bottom.kind !== 'jeans' && bottom.socks) ink(c, H([[lx - legW * .45, hip + .04], [lx + legW * .45, hip + .04]]), lwi, mixCol(legCol, '#ffffff', .35), 'inout');
      // shoe: a rounded blob at the ankle, pointing along the shin
      const sh = bottom.shoes || '#e9e9ef', d = unit(fx - kx, fy - ky), n = [-d[1], d[0]];
      const shoe = capsule(fx - d[0] * .01, fy - d[1] * .01, fx + d[0] * .06, fy + d[1] * .06, legW * 1.1, legW * 1.2);
      const shoeShapes = [{ pts: H(shoe), fill: sh, shade: crescent(shoe, mixCol(sh, '#000000', .35), 1, .0, .05) }];
      if (bottom.sole) shoeShapes.push({ pts: H(capsule(fx + d[0] * .05, fy + d[1] * .05, fx + d[0] * .085, fy + d[1] * .085, legW * 1.25, legW * 1.25)), fill: bottom.sole });
      group(c, shoeShapes, { lw, outline: inkC });
    }
    if (bottom.kind === 'skirt') {
      const kc = bottom.color || '#2e3b52', y0 = torsoH * .66, y1 = torsoH + .06, hw = tw * .64;
      const sk = [[-hw * .8, y0], [hw * .8, y0], [hw, y1 - .02], [hw * .9, y1 + .02, 'c']]; for (let i = 1; i <= 5; i++) sk.push([lerp(hw * .9, -hw * .9, i / 6), y1 + (i % 2 ? .045 : .0), 'c']); sk.push([-hw * .9, y1 + .02, 'c'], [-hw, y1 - .02]);
      group(c, [{ pts: H(sk), fill: kc, tension: .4, shade: [-.65, -.15, .35].map(px => ({ pts: H([[px * hw, y0 - .1], [px * hw + .09, y0 - .1], [px * hw + .12, y1 + .2], [px * hw - .02, y1 + .2]]), color: '#101522', alpha: .4 })) }], { lw, outline: inkC });
    }
    // torso (+ hem rib) and inner sweater for a jacket
    if (top.kind === 'jacket') {
      const swc = top.inner || '#8a8f9c', swd = mixCol(swc, '#000000', .3), tp = torso(tw * .72, tw * .82, torsoH * .88);
      group(c, [{ pts: H(tp), fill: swc, shade: crescent(tp, swd, 1, .06, 0) }], { lw, outline: inkC });
      for (let i = -3; i <= 3; i++) ink(c, H([[i * .05, .04], [i * .056, torsoH * .78]]), lwi * .7, 'rgba(20,20,30,.3)', 'inout');
    } else {
      const tp = torso(tw, tw * 1.12, torsoH), rib = [[-tw * .5, torsoH - .05], [tw * .5, torsoH - .05], [tw * .48, torsoH + .03], [-tw * .48, torsoH + .03]];
      group(c, [{ pts: H(tp), fill: tc, shade: crescent(tp, tDk, 1, .07, .02) }, { pts: H(rib), fill: tLt, tension: .3 }], { lw, outline: inkC });
      for (let i = -3; i <= 3; i++) ink(c, H([[i * .06, torsoH - .04], [i * .06, torsoH + .02]]), lwi * .6, 'rgba(0,0,0,.25)', 'none');
      if (top.kind === 'hoodie') { ink(c, H([[0, .0], [0, torsoH - .05]]), lwi * 1.2, top.zip || '#c9cbd6', 'none'); for (const sd of [-1, 1]) ink(c, H([[sd * .08, -.02], [sd * .1, torsoH * .35], [sd * .06, torsoH * .6]]), lwi, top.string || '#e8e8ee', 'none'); ink(c, H([[-.24, torsoH * .5], [-.25, torsoH - .06]]), lwi, tLt, 'inout'); ink(c, H([[.24, torsoH * .5], [.25, torsoH - .06]]), lwi, tLt, 'inout'); }
    }
    // sleeves: shoulder → elbow → cuff. a = raise (0 hanging .. ~2.4 fist beside the head). Cuff 1.3× wider (萌え袖), fist half out.
    const raised = [], sleeveL = top.sleeve ?? torsoH * 1.0, sw0 = top.sleeveWidth ?? .24;
    const sleeve = (sd, a) => {
      c.save(); c.translate(sd * tw * .5 * s, .02 * s);
      const up = clamp((a - .6) / 1.6);                                   // 0 hanging .. 1 raised (elbow bent 90°)
      const upperA = -sd * (.15 + a * .55), upperL = sleeveL * .55;
      const ex = Math.sin(upperA) * upperL, ey = Math.cos(upperA) * upperL;        // elbow
      const foreA = upperA - sd * up * 1.5, foreL = sleeveL * .5;
      const hx = ex + Math.sin(foreA) * foreL, hy = ey + Math.cos(foreA) * foreL;   // cuff
      const upper = capsule(0, 0, ex, ey, sw0, sw0 * 1.05), fore = capsule(ex, ey, hx, hy, sw0 * 1.05, sw0 * 1.3);
      group(c, [{ pts: H(upper), fill: tc, shade: crescent(upper, tDk, 1, .05, .02) }, { pts: H(fore), fill: tc, shade: crescent(fore, tDk, 1, .05, .02) }], { lw, outline: inkC });
      const d = unit(hx - ex, hy - ey), n = [-d[1], d[0]];
      for (let i = -1; i <= 1; i++) ink(c, H([[hx + n[0] * sw0 * .5 * .8 - d[0] * (.05 + i * .02), hy + n[1] * sw0 * .5 * .8 - d[1] * (.05 + i * .02)], [hx - n[0] * sw0 * .5 * .8 - d[0] * (.05 + i * .02), hy - n[1] * sw0 * .5 * .8 - d[1] * (.05 + i * .02)]]), lwi * .6, 'rgba(255,255,255,.2)', 'inout');
      if (sd === 1 && top.badge) shape(c, H(roundRectPts(ex * .5 + .02, ey * .5 - .02, .09, .08, .015)), { fill: '#e8e8ec', stroke: inkC, lw: lwi });
      if (up > .2 || pose.fists) { const f = fist(hx + d[0] * .05, hy + d[1] * .05, .075); c.save(); tracePath(c, H(fore)); c.clip(); c.restore();
        group(c, [{ pts: H(f.pts), fill: skin, shade: crescent(f.pts, skinDk, 1, .03, .03) }], { lw: lw * .8, outline: inkC }); for (const l of f.lines) ink(c, H(l), lwi * .7, mixCol(skin, '#a05a40', .5), 'inout');
        group(c, [{ pts: H(capsule(hx - d[0] * .04, hy - d[1] * .04, hx + d[0] * .03, hy + d[1] * .03, sw0 * 1.3, sw0 * 1.28)), fill: tc }], { lw, outline: inkC }); }
      c.restore();
    };
    for (const [sd, a] of [[-1, pose.armL || 0], [1, pose.armR || 0]]) { if (a > 1.2) raised.push([sd, a]); else sleeve(sd, a); }
    if (top.kind === 'jacket') for (const sd of [-1, 1]) {
      const front = [[sd * .06, -.06], [sd * tw * .5, -.06], [sd * tw * .64, torsoH * .3], [sd * tw * .62, torsoH * .92, 'c'], [sd * tw * .5, torsoH + .02], [sd * .16, torsoH], [sd * .1, torsoH * .3]];
      group(c, [{ pts: H(front), fill: tc, shade: crescent(front, tDk, 1, .06, .02), light: [{ pts: H([[sd * .06, -.1], [sd * .12, -.1], [sd * .16, 1], [sd * .1, 1]]), color: tLt, alpha: .5 }] }], { lw, outline: inkC });
    }
    // collar: chunky rolled turtleneck (jacket), hood rim (hoodie) or a simple neckline
    if (top.kind === 'jacket') {
      const swd = mixCol(top.inner || '#8a8f9c', '#000000', .3), col = [[-.34, -.14], [-.2, -.24], [0, -.27], [.2, -.24], [.34, -.14], [.36, .06], [.2, .13], [0, .15], [-.2, .13], [-.36, .06]];
      group(c, [{ pts: H(col), fill: swd, shade: crescent(col, '#2e3038', 1, .0, .07) }], { lw, outline: inkC });
      for (let i = -4; i <= 4; i++) ink(c, H([[i * .07, -.2 + Math.abs(i) * .012], [i * .074, .1 - Math.abs(i) * .01]]), lwi * .8, 'rgba(20,20,30,.35)', 'inout');
    } else if (top.kind === 'hoodie') group(c, [{ pts: H([[-.32, -.1], [0, .02], [.32, -.1], [.32, .04], [0, .14], [-.32, .04]]), fill: tLt, shade: [{ pts: H([[-.5, -.02], [.5, -.02], [.5, .3], [-.5, .3]]), color: tDk, alpha: .4 }] }], { lw, outline: inkC });
    else group(c, [{ pts: H([[-.2, -.08], [.2, -.08], [.22, .05], [0, .12], [-.22, .05]]), fill: tLt }], { lw, outline: inkC });
    c.restore(); // body

    // ---- head (pivot at the neck)
    c.save(); c.translate(0, .46 * s); c.rotate(tl); c.translate(0, -.46 * s);
    const facePts = head(hd2), face = H(facePts);
    const bangList = bangs(hair.bangs || {}, sway), bangPolys = bangList.map(t => hairTuft(t.spine, t.w, t.round));
    group(c, [{ pts: H([[-.1, .3], [.1, .3], [.12, .52], [-.12, .52]]), fill: skin, shade: [{ pts: H([[-.2, .3], [.2, .3], [.2, .5], [-.2, .5]]), color: skinDk, alpha: .5 }] },
      { pts: face, fill: skin, shade: bangPolys.map(p => ({ pts: H(shift(p, .0, .055)), color: skinDk, alpha: .35 })) }], { lw: lw * 1.1, outline: inkC });
    // face: eyes are the stars — width = eyes.size of the head (default .27), centre at eyes.y of the head box
    const ey = spec.eyes || {}, eyeY = ((ey.y ?? .64) - .5) * s, eyeX = (ey.spacing ?? .23) * s, ew = (ey.size ?? .27) * s, eh = ew * (ey.aspect ?? 1.0);
    const bl = pose.blush ?? 0; if (bl > 0) for (const sd of [-1, 1]) blush(c, sd * .31 * s, eyeY + eh * .62, .09 * s, spec.blushColor || '#f39a8f', .45 * bl, spec.blushLines !== false);
    for (const sd of [-1, 1]) {
      c.save(); c.translate(sd * eyeX, eyeY); c.rotate(-sd * (ey.tilt || 0));
      const st = Array.isArray(pose.eyes) ? pose.eyes[sd < 0 ? 0 : 1] : (pose.eyes || 'round');
      const op = Array.isArray(pose.eyeOpen) ? pose.eyeOpen[sd < 0 ? 0 : 1] : (pose.eyeOpen ?? 1);
      animeEye(c, ew, eh, { style: st, open: op, iris: ey.iris || '#3ec7c0', look: pose.look, side: sd, ink: inkC, lash: ey.lash ?? .7, brow: pose.brow ? { y: pose.brow.y ?? .55, angle: pose.brow.angle || 0, w: 1.6, color: hd } : null });
      c.restore();
    }
    const mo = spec.mouth || {}, mk = pose.mouth || 'smile';
    c.save(); c.translate((mo.x || 0) * s, ((mo.y ?? .84) - .5) * s);
    mouth(c, pose.mouthPts || mouthPts(mk), (mo.width ?? .12) * s, { fang: pose.fang, teeth: pose.teeth ?? (mk === 'yell' ? 'zig' : false), ink: inkC });
    c.restore();
    // bangs (front), crown highlight clipped to the hair
    // crown piece (the upper part of the hair mass) in the SAME group as the bangs, so no seam line appears at the roots
    const hlY = (hair.bangs?.hairline ?? .3) - .5, crown = []; for (let i = 0; i <= 14; i++) { const a = Math.PI + i / 14 * Math.PI; crown.push([Math.cos(a) * (.5 + vol), -.06 + Math.sin(a) * (.5 + vol * .8)]); } crown.push([.5 + vol, hlY - .1], [0, hlY - .06], [-.5 - vol, hlY - .1]);
    group(c, [{ pts: H(crown), fill: hc, tension: .9 }].concat(bangList.map((t, i) => ({ pts: H(bangPolys[i]), fill: hc, shade: crescent(bangPolys[i], hd, 1, .045, .03) }))), { lw, outline: inkC });
    if (hair.highlight !== false) {
      const r0 = .5 + vol, zz = []; for (let i = 0; i <= 10; i++) { const a = Math.PI * (1.15 + i / 10 * .7); zz.push([Math.cos(a) * r0 * .8, -.02 + Math.sin(a) * r0 * .62]); }
      for (let i = 10; i >= 0; i--) { const a = Math.PI * (1.15 + i / 10 * .7); zz.push([Math.cos(a) * r0 * .8, -.02 + Math.sin(a) * r0 * .62 + .07 + (i % 2 ? .04 : 0), 'c']); }
      c.save(); c.beginPath(); tracePath(c, H(mass), { raw: true }); for (const p of bangPolys) tracePath(c, H(p), { raw: true }); c.clip();
      shape(c, H(zz), { fill: mixCol(hc, hl, .6), alpha: .7, tension: .5 }); c.restore();
    }
    for (const st of hair.streaks || []) ink(c, H(st.spine), s * st.w, st.color || hd, 'inout');
    // hat (cap): dome over the crown, brim as a crescent curving forward, shadow under the brim on the face
    if (spec.hat && spec.hat.kind === 'cap') {
      const hcol = spec.hat.color || '#222228', bc = spec.hat.brim || '#c2323c', r = .5 + vol + .03, by = -.5 + (spec.hat.y ?? .22);
      const dome = []; for (let i = 0; i <= 12; i++) { const a = Math.PI + i / 12 * Math.PI; dome.push([Math.cos(a) * r, by + Math.sin(a) * r * 1.02 + .02]); } dome.push([r, by + .02], [0, by + .06], [-r, by + .02]);
      const brim = [[-r * .98, by - .02], [-r * .55, by - .08], [0, by - .1], [r * .55, by - .08], [r * .98, by - .02], [r * .95, by + .06], [r * .55, by + .14], [0, by + .17], [-r * .55, by + .14], [-r * .95, by + .06]];
      c.save(); tracePath(c, face); c.clip(); shape(c, H(shift(brim, 0, .07)), { fill: skinDk, alpha: .35 }); c.restore();
      group(c, [{ pts: H(dome), fill: hcol, tension: .9, shade: crescent(dome, '#000', 1, .07, .04), light: [{ pts: H([[-.5, -.9], [-.2, -1], [-.15, -.6], [-.45, -.55]]), color: '#55555f', alpha: .35 }] },
        { pts: H(brim), fill: bc, tension: .8, shade: [{ pts: H([[-1, by + .06], [1, by + .06], [1, 1], [-1, 1]]), color: '#000', alpha: .3 }] }], { lw, outline: inkC });
      for (const x of [-.22, 0, .22]) ink(c, H([[x * .5, by - r * .95 + .04], [x, by]]), lwi * .7, 'rgba(0,0,0,.4)', 'inout');
    }
    // ahoge
    if (hair.ahoge) { const ah = hair.ahoge === true ? {} : hair.ahoge, kind = ah.kind || 'loop', x0 = ah.x ?? 0, y0 = -.06 - (.5 + vol * .8) + .02;
      const sp = kind === 'loop' ? [[x0 - .03, y0], [x0 - .1 + sway * .03, y0 - .2], [x0 + .02 + sway * .06, y0 - .3, 'c'], [x0 + .12 + sway * .03, y0 - .18], [x0 + .05, y0]] : [[x0, y0], [x0 + .06 + sway * .05, y0 - .18], [x0 + .2 + sway * .1, y0 - .3]];
      group(c, [{ pts: H(taper(sp, u => .06 * (1 - u * .5), { samples: 24 })), fill: hc }], { lw: lw * .9, outline: inkC }); }
    // ears (on top of hair and hat)
    if (spec.ears) for (const sd of [-1, 1]) {
      const tw2 = (pose.earTwitch || 0), e = catEar({ ...spec.ears, tilt: (spec.ears.tilt ?? .4) + tw2 * .3 + sway * .1 }, sd, vol);
      group(c, [{ pts: H(e.outer), fill: spec.ears.color || hc, tension: .9, shade: crescent(e.outer, hd, 1, .05, .04) },
        { pts: H(e.inner), fill: spec.ears.inner || '#f3f0ee', tension: .9, shade: crescent(e.inner, '#c9c3c0', 1, .03, .03) }], { lw, outline: inkC });
      for (const f of e.fluff) shape(c, H(f), { fill: '#ffffff', alpha: .9 });
    }
    if (spec.hairclip) { const sd = spec.hairclip.side || -1; c.save(); c.translate(sd * .34 * s, -.12 * s); c.rotate(sd * .5); shape(c, H(roundRectPts(-.06, -.02, .12, .04, .01)), { fill: spec.hairclip.color || '#e9e9ef', stroke: inkC, lw: lwi }); c.restore(); }
    if (pose.emote) emote(c, pose.emote.kind, (pose.emote.x ?? .55) * s, (pose.emote.y ?? -.55) * s, (pose.emote.s ?? .16) * s, pose.emote.age ?? 1, pose.emote.color);
    c.restore(); // head
    if (raised.length) { c.save(); c.translate(0, .46 * s); for (const [sd, a] of raised) sleeve(sd, a); c.restore(); }
    c.restore();
  }

  Object.assign(window, { chibi, PARTS: { head, hairMass, bangs, sideLocks, backHair, catEar, tuftSpine, hairTuft, hairProfile, torso, capsule, fist } });
})();
