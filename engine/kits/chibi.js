// chibi.js: a formula-driven chibi (SD) character rig on top of vector.js. Load after vector.js.
//
//   chibi(c, spec, pose)      draw one character. spec = ratios + colours (who), pose = expression / limbs / motion (now).
//   PARTS.head / bangs / sideLocks / backHair / ear / eyeBox ...   the generators, usable on their own.
//
// Nothing here is a hand-placed coordinate list: every part is generated from a few ratios that come from drawing
// tutorials (see engine/docs/research-chibi-construction.md and engine/VECTOR_GUIDE.md). Units: pose.s = head width in
// px; local origin = head centre; y down; the head box spans y -.5 .. +.5 (face fractions f map to y = f - .5).
(() => {
  'use strict';
  const INKC = '#1c1a22';
  const R = (seed) => { const r = rng(seed * 7919 + 13); return () => r(); };
  const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

  // ---------- head outline: "mochi" (round top, cheeks at `cheek`, narrower rounded chin) ----------
  // w: width (1), h: height, cheek: y fraction (0 top .. 1 bottom) of the widest point, chin: 0 round .. 1 pointed,
  // jaw: width ratio at 85% height. Returns 16 points, closed.
  function head({ w = 1, h = 1, cheek = .6, chin = .25, jaw = .64 } = {}) {
    const pts = [], n = 16;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU - Math.PI / 2, cx = Math.cos(a), sy = Math.sin(a);
      const f = (sy + 1) / 2;                                   // 0 top .. 1 bottom
      let xr = 1;
      if (f > cheek) { const k = (f - cheek) / (1 - cheek); xr = 1 - (1 - jaw) * Math.pow(k, 1.7) - chin * .18 * k * k * k; }
      else { const k = 1 - f / cheek; xr = 1 - .06 * k * k; }
      pts.push({ x: cx * xr * w / 2, y: (sy * .5 + (f > cheek ? chin * .04 * (f - cheek) : 0)) * h });
    }
    return pts;
  }

  // ---------- hair ----------
  // A tuft spine: from a base point on the hairline, radially away from the whorl, with an S-curve.
  // len in head units, curl -1..1 (bend of the tip, sideways), dir = unit direction, wob = extra sideways bow at mid.
  function tuftSpine(bx, by, dir, len, curl, wob = 0) {
    const nx = -dir[1], ny = dir[0];
    return [[bx, by], [bx + dir[0] * len * .5 + nx * wob * len, by + dir[1] * len * .5 + ny * wob * len], [bx + dir[0] * len + nx * curl * len * .5, by + dir[1] * len + ny * curl * len * .5]];
  }
  // Hair-tuft width profile: wide for most of the length, then a rounded taper to a point (not a spike).
  const hairProfile = (w, round = .45) => u => w * (u < 1 - round ? 1 - u * .12 : (1 - .12 * (1 - round)) * Math.pow(Math.cos((u - (1 - round)) / round * Math.PI / 2), .75));
  const hairTuft = (spine, w, round) => taper(spine, hairProfile(w, round), { samples: 28 });

  // Bangs: n tufts hanging from the hairline (y = hairline fraction of the head), radiating from the whorl.
  //  { n, part (-1..1: where the parting sits), hairline, length (fraction of head height), lengthVar, widthVar, curl, seed, spread }
  function bangs({ n = 5, part = -.3, hairline = .28, length = .3, lengthVar = .1, widthVar = .3, curl = .25, seed = 1, spread = 1.05, fan = .35 } = {}, sway = 0) {
    const rnd = R(seed), out = [], y0 = hairline - .5;
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? .5 : i / (n - 1), bx = (u - .5) * spread, cur = Math.cos(Math.asin(clamp(bx / .58, -1, 1)));
      const root = y0 - .16 - (1 - cur) * .12;                     // hidden inside the hair cap
      const dir = unit((bx - part * .15) * fan, 1);                 // mostly down, fanning out from the parting
      const L = (length + .16 + (1 - cur) * .12) * (1 + (rnd() - .5) * 2 * lengthVar);
      const w = (spread / n) * 1.45 * (1 + (rnd() - .5) * 2 * widthVar);
      const cdir = (i % 2 ? 1 : -1) * (bx < part * .15 ? -1 : 1);
      const spine = tuftSpine(bx, root, dir, L, curl * cdir * .5 + sway * .4, (rnd() - .5) * .08 + sway * .2);
      out.push({ spine, w, round: .5, order: Math.abs(u - .5) });   // centre tufts drawn last (on top)
    }
    return out.sort((a, b) => b.order - a.order);
  }
  // Side locks: 1..n long tufts in front of the ear on each side, falling down with a gentle inward curve.
  function sideLocks({ n = 2, length = .9, width = .24, curl = -.15, seed = 2 } = {}, sway = 0) {
    const rnd = R(seed), out = [];
    for (const sd of [-1, 1]) for (let i = 0; i < n; i++) {
      const k = i / Math.max(1, n - 1), bx = sd * (.5 - k * .1), by = -.3 + k * .12, L = length * (1 - k * .25) * (1 + (rnd() - .5) * .2);
      const spine = tuftSpine(bx, by, unit(sd * .12, 1), L, curl * sd + sway * .6 * (1 + k), sway * .3);
      out.push({ spine, w: width * (1 - k * .35), round: .6 });
    }
    return out;
  }
  // Back hair mass: 'bob' (ends at the chin), 'long' (to the waist), plus 'ponytail'/'twin' bundles.
  function backHair({ style = 'bob', length = .6, volume = .1, ends = 5, seed = 3, side = 1 } = {}, sway = 0) {
    const rnd = R(seed), out = [];
    if (style === 'bob' || style === 'long') {
      const L = style === 'bob' ? .35 + length * .3 : .8 + length * .6, hw = (style === 'bob' ? .5 : .42) + volume;
      const pts = [[-hw, -.2], [-hw - .04, .1], [-hw * .92, .5 + L * .3], [-hw * .8, .5 + L * .5]];
      for (let i = 0; i <= ends; i++) { const u = i / ends; pts.push([lerp(-hw * .9, hw * .9, u), .5 + L * .5 + (i % 2 ? .06 : -.02) * (1 + rnd()) + L * .5 * Math.sin(u * Math.PI) * .2]); }
      pts.push([hw * .8, .5 + L * .5], [hw * .92, .5 + L * .3], [hw + .04, .1], [hw, -.2], [0, -.45]);
      out.push({ pts: pts.map(([x, y]) => [x + sway * .25 * Math.max(0, y + .2), y]), round: 0 });
    }
    if (style === 'ponytail' || style === 'twin') {
      const knots = style === 'twin' ? [[-.48, -.15], [.48, -.15]] : [[side * .42, -.32]];
      for (const [kx, ky] of knots) for (let i = 0; i < 3; i++) {
        const sd = Math.sign(kx) || 1, a = (.15 + i * .18) + (rnd() - .5) * .08, dir = unit(sd * Math.cos(a) * .5, Math.sin(a) + .8);
        const L = (.55 + length * .5) * (1 - Math.abs(i - 1) * .1);
        out.push({ spine: tuftSpine(kx, ky, dir, L, (i % 2 ? .35 : -.25) * sd + sway * .8, (rnd() - .5) * .15 + sway * .3), w: .34 - i * .04, round: .55, knot: [kx, ky] });
      }
    }
    return out;
  }
  // Cat ear: base on the skull at angle `at` (radians from straight up, outward), size = height in head units.
  // Outer edge bows outward, inner edge is straighter; returns { outer, inner } point lists (local head units).
  function catEar({ size = .5, at = .55, tilt = .15, width = .36, bow = .1 } = {}, sd = 1) {
    const cx = Math.sin(at) * .5 * sd, cy = -.5 + (1 - Math.cos(at)) * .45;       // base centre on the skull circle
    const dir = unit(Math.sin(at + tilt) * sd, -Math.cos(at + tilt)), nx = -dir[1] * sd, ny = dir[0] * sd; // (nx, ny) = outward
    const P = (t, u) => [cx + dir[0] * size * t + nx * width * u, cy + dir[1] * size * t + ny * width * u];
    const outer = [P(-.05, .5), P(.35, .5 + bow), P(.75, .28 + bow * .5), [...P(1.0, 0), 'c'], P(.7, -.28), P(.3, -.46), P(-.05, -.5)];
    const inner = [P(.15, .24), P(.45, .26), [...P(.8, .0), 'c'], P(.45, -.2), P(.15, -.22)];
    const fluff = [[.0, .1]].map(([t, u]) => taper([P(t + .12, u), P(t + .24, u * .9), P(t + .34, u * .8)], hairProfile(.04, .6), { samples: 12 }));
    return { outer, inner, fluff, tip: P(1, 0), base: [cx, cy] };
  }
  // ---------- body generators (local origin = chin, y down, head units) ----------
  // Torso as a pear: shoulders width sw, hips width hw, height h.
  const torso = (sw, hw, h, y0 = -.02) => [[-sw / 2, y0], [sw / 2, y0], [hw / 2 + .02, y0 + h * .55], [hw / 2, y0 + h, 'c'], [-hw / 2, y0 + h, 'c'], [-hw / 2 - .02, y0 + h * .55]];
  // Capsule (pill) along a direction: used for sleeves, legs, tails.
  function capsule(x0, y0, x1, y1, w0, w1 = w0) {
    const d = unit(x1 - x0, y1 - y0), n = [-d[1], d[0]], k = .55;
    return [[x0 + n[0] * w0 / 2, y0 + n[1] * w0 / 2], [x1 + n[0] * w1 / 2, y1 + n[1] * w1 / 2], [x1 + n[0] * w1 * .35 + d[0] * w1 * .45, y1 + n[1] * w1 * .35 + d[1] * w1 * .45], [x1 - n[0] * w1 * .35 + d[0] * w1 * .45, y1 - n[1] * w1 * .35 + d[1] * w1 * .45], [x1 - n[0] * w1 / 2, y1 - n[1] * w1 / 2], [x0 - n[0] * w0 / 2, y0 - n[1] * w0 / 2], [x0 - n[0] * w0 * .35 - d[0] * w0 * k * .8, y0 - n[1] * w0 * .35 - d[1] * w0 * k * .8], [x0 + n[0] * w0 * .35 - d[0] * w0 * k * .8, y0 + n[1] * w0 * .35 - d[1] * w0 * k * .8]];
  }

  // ---------- the rig ----------
  function chibi(c, spec, pose) {
    const s = pose.s, sq = pose.squash || 0, sway = pose.hairSway || 0, tl = pose.tilt || 0, inkC = spec.ink || INKC;
    const lw = s * (spec.lineWidth ?? .022), skin = spec.skin || '#fde5d3', skinDk = spec.skinShade || mixCol(skin, '#c8604a', .3);
    const H = pts => pts.map(p => Array.isArray(p) ? [p[0] * s, p[1] * s, p[2]] : { ...p, x: p.x * s, y: p.y * s });
    const hair = spec.hair || {}, hc = hair.color || '#6fd3e6', hd = hair.dark || mixCol(hc, '#1a2a6a', .45), hl = hair.light || mixCol(hc, '#ffffff', .55);
    const hairShade = (pts) => [{ pts: H(pts), color: hd, alpha: .45 }];
    const hd2 = spec.head || {}, body = spec.body || {}, top = body.top || {}, bottom = body.bottom || {};
    const heads = body.heads ?? 2.0, bodyH = heads - 1;              // body height in head units
    const jump = pose.jump || 0;
    const drawTufts = (list, fill, shade) => group(c, list.map(t => ({ pts: t.pts ? H(t.pts) : H(hairTuft(t.spine, t.w, t.round)), fill, tension: t.pts ? .8 : 1, shade })), { lw, outline: inkC });

    c.save(); c.translate(pose.x, pose.y + (pose.bob || 0) * s); c.scale(1 + sq * .35, 1 - sq * .35);
    // ground shadow
    c.save(); c.globalAlpha = .16 * (1 - jump * .6); c.fillStyle = inkC; c.beginPath(); c.ellipse(0, (.5 + bodyH + .03 + jump * .2) * s, .38 * s * (1 - jump * .3), .05 * s, 0, 0, TAU); c.fill(); c.restore();

    // tail
    if (spec.tail) {
      const wag = pose.tailWag || 0, sd = spec.tail.side || 1, tc = spec.tail.color || hc;
      const spine = [[sd * .18, .45 + bodyH * .35], [sd * (.42 + wag * .05), .55 + bodyH * .4 + wag * .05], [sd * (.6 + wag * .1), .35 + bodyH * .3 + wag * .12], [sd * (.68 + wag * .12), .1 + bodyH * .2 + wag * .2]];
      group(c, [{ pts: H(tailPts(spine, .17)), fill: tc, shade: hairShade([[sd * .1, .6], [sd * .8, 1.4], [sd * 1, .2], [sd * .5, .3]]) }], { lw, outline: inkC });
    }
    // back hair (mass, ponytail / twin tails)
    const backSpec = hair.back || { style: 'bob' };
    const backList = backHair(backSpec, sway);
    drawTufts(backList, hc, hairShade([[-1.5, .0], [1.5, .0], [1.5, 2.5], [-1.5, 2.5]]));
    for (const b of backList) if (b.knot && hair.ribbon) shape(c, H(ellipsePts(b.knot[0], b.knot[1], .07, .05, 8)), { fill: hair.ribbon, stroke: inkC, lw: lw * .6 });
    if (top.kind === 'hoodie') group(c, [{ pts: H([[-.34, .35], [-.36, .55], [-.2, .65], [.2, .65], [.36, .55], [.34, .35], [0, .25]]), fill: top.color || '#1d1d24', shade: [{ pts: H([[-1, .5], [1, .5], [1, 1], [-1, 1]]), color: '#000', alpha: .35 }] }], { lw, outline: inkC });
    // side locks (behind the body but in front of the back hair)
    drawTufts(sideLocks(hair.side || {}, sway), hc, hairShade([[-1.5, .35], [1.5, .35], [1.5, 2.5], [-1.5, 2.5]]));

    // ---- body (origin at the chin)
    c.save(); c.translate(0, .46 * s);
    const tw = body.torsoWidth ?? .58, torsoH = bodyH * .55, legH = bodyH * .45, legW = body.legWidth ?? .17, legGap = body.legGap ?? .16;
    const tc = top.color || '#2b2f4a', tLt = top.light || mixCol(tc, '#ffffff', .25), tDk = top.dark || mixCol(tc, '#000000', .45);
    const legBend = sd => (sd < 0 ? pose.legL : pose.legR) ?? jump * .5;
    for (const sd of [-1, 1]) {                                     // legs + shoes
      const bend = legBend(sd), lx = sd * legGap, y0 = torsoH - .06, y1 = torsoH + legH - .06 * bend;
      c.save(); c.translate(lx * s, y0 * s); c.rotate(sd * bend * .5); c.translate(-lx * s, -y0 * s);
      const legCol = bottom.kind === 'jeans' ? (bottom.color || '#7fa6c9') : (bottom.socks || skin), legDk = mixCol(legCol, '#1a1a30', .35);
      group(c, [{ pts: H(capsule(lx, y0, lx, y1, legW, legW * .92)), fill: legCol, shade: [{ pts: H([[lx + .02, y0 - .2], [lx + .3, y0 - .2], [lx + .3, y1 + .2], [lx + .04, y1 + .2]]), color: legDk, alpha: .45 }] }], { lw, outline: inkC });
      if (bottom.kind === 'jeans' && bottom.ripped) { shape(c, H(ellipsePts(lx, y0 + (y1 - y0) * .55, legW * .4, .035, 10)), { fill: skin, stroke: inkC, lw: lw * .5 }); for (let i = -1; i <= 1; i++) ink(c, H([[lx - legW * .35, y0 + (y1 - y0) * .55 + i * .02], [lx + legW * .35, y0 + (y1 - y0) * .55 + i * .02]]), lw * .35, '#eef2ff', 'inout'); }
      if (bottom.kind !== 'jeans' && bottom.socks) ink(c, H([[lx - legW * .4, y0 + .05], [lx + legW * .4, y0 + .05]]), lw * .4, mixCol(legCol, '#ffffff', .3), 'inout');
      const sh = bottom.shoes || '#e9e9ef', shoe = [[lx - legW * .7, y1 - .02], [lx + legW * .7, y1 - .02], [lx + legW * .8, y1 + .08, 'c'], [lx - legW * .8, y1 + .08, 'c']];
      const shapes = [{ pts: H(shoe), fill: sh, shade: [{ pts: H([[-1, y1 + .04], [1, y1 + .04], [1, 2], [-1, 2]]), color: mixCol(sh, '#000000', .35), alpha: .5 }] }];
      if (bottom.sole) shapes.push({ pts: H([[lx - legW * .85, y1 + .04], [lx + legW * .85, y1 + .04], [lx + legW * .85, y1 + .1, 'c'], [lx - legW * .85, y1 + .1, 'c']]), fill: bottom.sole });
      group(c, shapes, { lw, outline: inkC });
      c.restore();
    }
    if (bottom.kind === 'skirt') {                                   // pleated skirt under the top
      const kc = bottom.color || '#2e3b52', y0 = torsoH * .7, y1 = torsoH + .04, hw = tw * .62;
      const sk = [[-hw * .85, y0], [hw * .85, y0], [hw, y1, 'c']]; for (let i = 1; i <= 4; i++) sk.push([lerp(hw, -hw, i / 5), y1 + (i % 2 ? .04 : 0)]); sk.push([-hw, y1, 'c']);
      group(c, [{ pts: H(sk), fill: kc, shade: [-.7, -.2, .3].map(px => ({ pts: H([[px * hw, y0 - .1], [px * hw + .1, y0 - .1], [px * hw + .13, y1 + .2], [px * hw - .02, y1 + .2]]), color: '#101522', alpha: .4 })) }], { lw, outline: inkC });
    } else if (bottom.kind === 'jeans') group(c, [{ pts: H([[-tw * .55, torsoH - .12], [tw * .55, torsoH - .12], [tw * .56, torsoH], [-tw * .56, torsoH]]), fill: bottom.color || '#7fa6c9', shade: [{ pts: H([[0, -1], [1, -1], [1, 2], [0, 2]]), color: '#1c2a44', alpha: .35 }] }], { lw, outline: inkC });
    // torso
    if (top.kind === 'jacket') {                                     // inner sweater under an open jacket
      const swc = top.inner || '#8a8f9c', swd = mixCol(swc, '#000000', .3);
      group(c, [{ pts: H(torso(tw * .7, tw * .8, torsoH * .85)), fill: swc, shade: [{ pts: H([[.04, -.2], [.5, -.2], [.5, 1], [.1, 1]]), color: swd, alpha: .55 }] }], { lw, outline: inkC });
      for (let i = -3; i <= 3; i++) ink(c, H([[i * .05, .02], [i * .056, torsoH * .75]]), lw * .35, 'rgba(20,20,30,.35)', 'inout');
    } else {
      group(c, [{ pts: H(torso(tw, tw * 1.1, torsoH)), fill: tc, shade: [{ pts: H([[.12, -.2], [.6, -.2], [.6, 1], [.16, 1]]), color: tDk, alpha: .45 }], light: [{ pts: H([[-tw * .5, -.1], [-tw * .34, -.1], [-tw * .34, 1], [-tw * .5, 1]]), color: tLt, alpha: .3 }] }], { lw, outline: inkC });
      if (top.kind === 'hoodie') { ink(c, H([[0, -.02], [0, torsoH]]), lw * .7, top.zip || '#c9cbd6', 'none'); for (const sd of [-1, 1]) ink(c, H([[sd * .08, -.04], [sd * .1, torsoH * .35], [sd * .06, torsoH * .6]]), lw * .45, top.string || '#e8e8ee', 'none'); ink(c, H([[-.22, torsoH * .55], [-.24, torsoH]]), lw * .5, tLt, 'inout'); ink(c, H([[.22, torsoH * .55], [.24, torsoH]]), lw * .5, tLt, 'inout'); }
    }
    // sleeves (pill capsules from the shoulder; a = angle, 0 hanging .. π/2 out .. >1.1 raised: drawn after the head)
    const raised = [], sleeveL = top.sleeve ?? torsoH * 1.05, sw0 = top.sleeveWidth ?? .24;
    const sleeve = (sd, a) => {
      c.save(); c.translate(sd * tw * .48 * s, .0); c.rotate(-sd * (.12 + a));
      const L = a > 1.1 ? sleeveL * .8 : sleeveL;
      group(c, [{ pts: H(capsule(0, -.02, sd * .02, L, sw0, sw0 * .95)), fill: tc, shade: [{ pts: H([[sd * .04, -.3], [sd * .5, -.3], [sd * .5, 2], [sd * .08, 2]]), color: tDk, alpha: .45 }], light: [{ pts: H([[sd * -.13, -.1], [sd * -.06, -.1], [sd * -.04, L], [sd * -.11, L]]), color: tLt, alpha: .35 }] }], { lw, outline: inkC });
      for (let i = 0; i < 3; i++) ink(c, H([[sd * -.09, L - .1 + i * .025], [sd * .1, L - .11 + i * .025]]), lw * .3, 'rgba(255,255,255,.18)', 'inout');
      if (sd === 1 && top.badge) shape(c, H(roundRectPts(.02, L * .25, .09, .08, .015)), { fill: '#e8e8ec', stroke: inkC, lw: lw * .45 });
      if (a > .4 || pose.fists) { c.translate(sd * .01 * s, (L + .02) * s); group(c, [{ pts: H(circlePts(0, 0, .085, 10)), fill: skin, shade: [{ pts: H([[-.1, .02], [.1, .02], [.1, .2], [-.1, .2]]), color: skinDk, alpha: .5 }] }], { lw: lw * .8, outline: inkC }); ink(c, H([[-.06, -.02], [.06, -.02]]), lw * .3, '#c98f78', 'inout'); }
      c.restore();
    };
    for (const [sd, a] of [[-1, pose.armL || 0], [1, pose.armR || 0]]) { if (a > 1.1) raised.push([sd, a]); else sleeve(sd, a); }
    if (top.kind === 'jacket') for (const sd of [-1, 1]) {           // open jacket fronts over the sweater
      const front = [[sd * .06, -.08], [sd * tw * .5, -.08], [sd * tw * .62, torsoH * .3], [sd * tw * .6, torsoH * .95, 'c'], [sd * .14, torsoH], [sd * .1, torsoH * .3]];
      group(c, [{ pts: H(front), fill: tc, shade: [{ pts: H([[sd * .2, -.2], [sd * .6, -.2], [sd * .6, 1], [sd * .28, 1]]), color: tDk, alpha: .45 }], light: [{ pts: H([[sd * .06, -.1], [sd * .12, -.1], [sd * .15, 1], [sd * .1, 1]]), color: tLt, alpha: .55 }] }], { lw, outline: inkC });
    }
    // collar
    if (top.kind === 'jacket') {
      const swd = mixCol(top.inner || '#8a8f9c', '#000000', .3);
      group(c, [{ pts: H([[-.3, -.16], [-.12, -.22], [.12, -.22], [.3, -.16], [.32, .06], [0, .12], [-.32, .06]]), fill: swd, shade: [{ pts: H([[-.4, -.08], [.4, -.08], [.4, .3], [-.4, .3]]), color: '#3a3d48', alpha: .5 }] }], { lw, outline: inkC });
      for (let i = -4; i <= 4; i++) ink(c, H([[i * .065, -.19], [i * .068, .07]]), lw * .4, 'rgba(20,20,30,.4)', 'inout');
    } else if (top.kind === 'hoodie') group(c, [{ pts: H([[-.3, -.1], [0, .0], [.3, -.1], [.3, .02], [0, .12], [-.3, .02]]), fill: tLt, shade: [{ pts: H([[-.5, -.04], [.5, -.04], [.5, .3], [-.5, .3]]), color: tDk, alpha: .4 }] }], { lw, outline: inkC });
    else group(c, [{ pts: H([[-.2, -.1], [.2, -.1], [.22, .04], [0, .1], [-.22, .04]]), fill: tLt }], { lw, outline: inkC });
    c.restore(); // body

    // ---- head (pivot at the neck)
    c.save(); c.translate(0, .46 * s); c.rotate(tl); c.translate(0, -.46 * s);
    const face = H(head(hd2));
    group(c, [{ pts: H([[-.09, .3], [.09, .3], [.11, .52], [-.11, .52]]), fill: skin, shade: [{ pts: H([[-.2, .3], [.2, .3], [.2, .5], [-.2, .5]]), color: skinDk, alpha: .5 }] },
      { pts: face, fill: skin, shade: [{ pts: H([[-.6, -.6], [.6, -.6], [.6, -.02], [.3, .03], [0, -.02], [-.3, .03], [-.6, -.02]]), color: mixCol(skin, '#d08a70', .35), alpha: .55 }] }], { lw: lw * 1.1, outline: inkC });
    // face
    const ey = spec.eyes || {}, eyeY = ((ey.y ?? .64) - .5) * s, eyeX = (ey.spacing ?? .22) * s, ew = (ey.size ?? .2) * s, eh = ew * (ey.aspect ?? .95);
    const bl = pose.blush ?? 0; if (bl > 0) for (const sd of [-1, 1]) blush(c, sd * .3 * s, eyeY + eh * .55, .085 * s, spec.blushColor || '#f39a8f', .45 * bl, spec.blushLines !== false);
    for (const sd of [-1, 1]) {
      c.save(); c.translate(sd * eyeX, eyeY); c.rotate(-sd * (ey.tilt || 0));
      const st = Array.isArray(pose.eyes) ? pose.eyes[sd < 0 ? 0 : 1] : (pose.eyes || 'round');
      const op = Array.isArray(pose.eyeOpen) ? pose.eyeOpen[sd < 0 ? 0 : 1] : (pose.eyeOpen ?? 1);
      animeEye(c, ew, eh, { style: st, open: op, iris: ey.iris || '#3ec7c0', look: pose.look, side: sd, ink: inkC, lash: ey.lash ?? .6, brow: pose.brow ? { y: pose.brow.y ?? .55, angle: pose.brow.angle || 0, w: 1.6, color: hd } : null });
      c.restore();
    }
    const mo = spec.mouth || {};
    c.save(); c.translate((mo.x || 0) * s, ((mo.y ?? .84) - .5) * s);
    mouth(c, pose.mouthPts || mouthPts(pose.mouth || 'smile'), (mo.width ?? .11) * s, { fang: pose.fang, teeth: pose.teeth, ink: inkC });
    c.restore();
    // hair volume behind the bangs (skull + volume), then the bangs
    const vol = hair.volume ?? .1, hairline = hair.bangs?.hairline ?? .28;
    const capPts = []; for (let i = 0; i <= 12; i++) { const a = Math.PI + i / 12 * Math.PI; capPts.push([Math.cos(a) * (.5 + vol), -.02 + Math.sin(a) * (.5 + vol) * 1.02]); }
    capPts.push([.5 + vol, hairline - .45], [0, hairline - .38], [-.5 - vol, hairline - .45]);
    const bangList = bangs(hair.bangs || {}, sway);
    const bangShapes = bangList.map(t => { const tip = t.spine[2], mid = t.spine[1]; return { pts: H(hairTuft(t.spine, t.w, t.round)), fill: hc,
      shade: [{ pts: H([[mid[0] - .5, mid[1] + .1], [mid[0] + .5, mid[1] + .1], [tip[0] + .5, tip[1] + .3], [tip[0] - .5, tip[1] + .3]]), color: hd, alpha: .22 }] }; });
    group(c, [{ pts: H(capPts), fill: hc, tension: .9 }].concat(bangShapes), { lw, outline: inkC });
    if (hair.highlight !== false) { // angel ring: a crescent high on the crown with a zig-zag lower edge, clipped to the hair
      const r0 = .5 + vol, zz = []; for (let i = 0; i <= 10; i++) { const a = Math.PI * (1.12 + i / 10 * .76); zz.push([Math.cos(a) * r0 * .9, -.02 + Math.sin(a) * r0 * .86]); }
      for (let i = 10; i >= 0; i--) { const a = Math.PI * (1.12 + i / 10 * .76); zz.push([Math.cos(a) * r0 * .9, -.02 + Math.sin(a) * r0 * .86 + .07 + (i % 2 ? .04 : 0), 'c']); }
      c.save(); c.beginPath(); tracePath(c, H(capPts), { tension: .9, raw: true }); for (const b of bangShapes) tracePath(c, b.pts, { raw: true }); c.clip();
      shape(c, H(zz), { fill: hl, alpha: .7, tension: .5 }); c.restore();
    }
    for (const st of hair.streaks || []) ink(c, H(st.spine), s * st.w, st.color || hd, 'inout');
    // hat
    if (spec.hat && spec.hat.kind === 'cap') {
      const hcol = spec.hat.color || '#222228', bc = spec.hat.brim || '#c2323c', r = .5 + vol + .04;
      const dome = []; for (let i = 0; i <= 10; i++) { const a = Math.PI + i / 10 * Math.PI; dome.push([Math.cos(a) * r, -.08 + Math.sin(a) * r * 1.05]); } dome.push([r, -.16], [0, -.2], [-r, -.16]);
      group(c, [{ pts: H(dome), fill: hcol, tension: .9, shade: [{ pts: H([[.1, -2], [1, -2], [1, 0], [.2, 0]]), color: '#000', alpha: .35 }], light: [{ pts: H([[-.5, -.7], [-.2, -.8], [-.15, -.5], [-.45, -.4]]), color: '#55555f', alpha: .35 }] },
        { pts: H([[-r + .02, -.16], [-.4, -.26], [0, -.3], [.4, -.26], [r - .02, -.16], [.42, -.02], [0, .04], [-.42, -.02]]), fill: bc, shade: [{ pts: H([[-1, -.14], [1, -.14], [1, 0], [-1, 0]]), color: '#000', alpha: .3 }] }], { lw, outline: inkC });
      for (const x of [-.25, 0, .25]) ink(c, H([[x * .6, -.08 - r * .95], [x, -.22]]), lw * .35, 'rgba(0,0,0,.45)', 'inout');
    }
    // ahoge
    if (hair.ahoge) { const ah = hair.ahoge === true ? {} : hair.ahoge, kind = ah.kind || 'loop', x0 = ah.x ?? 0, y0 = -.5 - vol + .02;
      const sp = kind === 'loop' ? [[x0 - .03, y0], [x0 - .1 + sway * .03, y0 - .22], [x0 + .02 + sway * .06, y0 - .34, 'c'], [x0 + .12 + sway * .03, y0 - .2], [x0 + .05, y0]] : [[x0, y0], [x0 + .06 + sway * .05, y0 - .2], [x0 + .2 + sway * .1, y0 - .32]];
      group(c, [{ pts: H(taper(sp, u => .06 * (1 - u * .5), { samples: 24 })), fill: hc }], { lw: lw * .9, outline: inkC }); }
    // ears (on top of hair and hat)
    if (spec.ears) for (const sd of [-1, 1]) {
      const tw2 = (pose.earTwitch || 0), e = catEar({ ...spec.ears, tilt: (spec.ears.tilt ?? .15) + tw2 * .3 + sway * .1 }, sd);
      group(c, [{ pts: H(e.outer), fill: spec.ears.color || hc, tension: .9, shade: hairShade([[sd * .3, -1.5], [sd * 1.5, -1.5], [sd * 1.5, .0], [sd * .45, .0]]) },
        { pts: H(e.inner), fill: spec.ears.inner || '#f3f0ee', tension: .9, shade: [{ pts: H([[sd * .4, -1.5], [sd * 1.5, -1.5], [sd * 1.5, .0], [sd * .55, -.3]]), color: '#c9c3c0', alpha: .5 }] }], { lw, outline: inkC });
      for (const f of e.fluff) shape(c, H(f), { fill: '#ffffff', alpha: .9 });
    }
    if (spec.hairclip) { const sd = spec.hairclip.side || -1; c.save(); c.translate(sd * .33 * s, -.1 * s); c.rotate(sd * .5); shape(c, H(roundRectPts(-.06, -.02, .12, .04, .01)), { fill: spec.hairclip.color || '#e9e9ef', stroke: inkC, lw: lw * .5 }); c.restore(); }
    if (pose.emote) emote(c, pose.emote.kind, (pose.emote.x ?? .55) * s, (pose.emote.y ?? -.55) * s, (pose.emote.s ?? .16) * s, pose.emote.age ?? 1, pose.emote.color);
    c.restore(); // head
    if (raised.length) { c.save(); c.translate(0, .46 * s); for (const [sd, a] of raised) sleeve(sd, a); c.restore(); }
    c.restore();
  }

  Object.assign(window, { chibi, PARTS: { head, bangs, sideLocks, backHair, catEar, tuftSpine, hairTuft, hairProfile, torso, capsule } });
})();
