// chibi.js: a data-driven chibi (SD) character rig on top of vector.js. Load after vector.js.
//   chibi(c, spec, pose)   draws one character; spec = who (colours, hair, outfit), pose = what now (expression, limbs, motion)
// Units: pose.s = head width in px. Local origin = head centre, y down. Every coordinate below is in head units.
// Proportions (the "2-head" chibi): head 1.0 tall (hair adds ~.15 above, ears/hat more), body ~.75, eyes at y +.2 (72 %
// down the face), mouth at +.37, chin at +.5. See engine/VECTOR_GUIDE.md for how to write a spec from a text brief.
(() => {
  'use strict';
  const INKC = '#1c1a22';

  // ---------- defaults ----------
  const DEFAULT_HAIR = {
    // hairline cap (always drawn under the bangs so the forehead is covered)
    cap: [[-.54, -.1], [-.55, -.4], [-.3, -.58], [0, -.63], [.3, -.58], [.55, -.4], [.54, -.1], [.3, -.05], [0, -.02], [-.3, -.05]],
    bangs: [
      { spine: [[-.46, -.22], [-.5, .0], [-.44, .3]], w: .16, curl: .3 },
      { spine: [[-.34, -.25], [-.38, .0], [-.3, .22]], w: .17, curl: -.2 },
      { spine: [[-.18, -.3], [-.2, -.05], [-.12, .16]], w: .18, curl: .1 },
      { spine: [[-.02, -.32], [.0, -.08], [.06, .2]], w: .2, curl: -.15 },
      { spine: [[.16, -.3], [.2, -.05], [.24, .12]], w: .17, curl: .2 },
      { spine: [[.32, -.26], [.38, -.02], [.44, .22]], w: .16, curl: -.25 },
      { spine: [[.44, -.2], [.5, .0], [.5, .3]], w: .14, curl: .2 },
    ],
    side: [
      { spine: [[-.5, -.05], [-.56, .35], [-.5, .85]], w: .2, curl: .4 },
      { spine: [[-.42, .05], [-.44, .45], [-.34, .75]], w: .12, curl: -.3 },
      { spine: [[.5, -.05], [.58, .3], [.56, .7]], w: .18, curl: -.4 },
    ],
    back: [],
    ahoge: null,
    streaks: [{ spine: [[-.18, -.2], [-.2, .0], [-.13, .14]], w: .035 }, { spine: [[.2, -.22], [.22, .0], [.27, .1]], w: .03 }],
    highlight: true,
  };
  // long straight hair down to the waist, one lock per side + a back mass
  const HAIR_LONG = {
    side: [
      { spine: [[-.5, -.05], [-.6, .4], [-.62, 1.1]], w: .22, curl: .1 },
      { spine: [[-.4, .05], [-.46, .5], [-.4, .95]], w: .12, curl: -.2 },
      { spine: [[.5, -.05], [.6, .4], [.62, 1.1]], w: .22, curl: -.1 },
      { spine: [[.4, .05], [.46, .5], [.4, .95]], w: .12, curl: .2 },
    ],
    back: [{ spine: [[0, -.3], [0, .3], [0, .9]], w: 1.0, curl: 0, profile: 'lin', tip: .7 }],
  };
  const HAIR_PONYTAIL = [
    { spine: [[.42, -.45], [.75, -.2], [.9, .35]], w: .22, curl: -.5 },
    { spine: [[.44, -.42], [.7, .0], [.8, .6]], w: .18, curl: .3 },
    { spine: [[.46, -.38], [.62, .15], [.65, .75]], w: .16, curl: -.2 },
  ];
  const AHOGE_LOOP = { spine: [[-.03, -.58], [-.1, -.8], [.02, -.92, 'c'], [.12, -.78], [.05, -.58]], w: .06, profile: 'lin', tip: .5 };
  const AHOGE_SPIKE = { spine: [[0, -.6], [.06, -.8], [.2, -.92]], w: .07, curl: .5 };

  function hairSpec(h = {}) {
    const preset = h.preset === 'long' ? HAIR_LONG : {};
    const out = { ...DEFAULT_HAIR, ...preset, ...h };
    if (h.ponytail) out.back = (out.back || []).concat(HAIR_PONYTAIL);
    if (h.ahoge === true || h.ahoge === 'loop') out.ahoge = AHOGE_LOOP; else if (h.ahoge === 'spike') out.ahoge = AHOGE_SPIKE;
    return out;
  }

  // ---------- the rig ----------
  function chibi(c, spec, pose) {
    const s = pose.s, sq = pose.squash || 0, sway = pose.hairSway || 0, tl = pose.tilt || 0, inkC = spec.ink || INKC;
    const lw = s * (spec.lineWidth ?? .022);
    const H = pts => pts.map(p => Array.isArray(p) ? [p[0] * s, p[1] * s, p[2]] : { ...p, x: p.x * s, y: p.y * s });
    const tuftH = (tf, extra = 0, swayK = 1) => H(tuft(tf.spine.map(([px, py, fl], i) => [px + sway * swayK * i * i * .08 + extra, py, fl]), tf.w, { curl: tf.curl || 0, profile: tf.profile || 'leaf', tip: tf.tip || 0 }));
    const hair = hairSpec(spec.hair), top = spec.top || {}, bottom = spec.bottom || {}, skin = spec.skin || '#fde5d3';
    const hairCol = spec.hairColor || '#6fd3e6', hairDk = spec.hairDark || mixCol(hairCol, '#1a2a6a', .5), hairLt = spec.hairLight || mixCol(hairCol, '#ffffff', .55);
    const hairShade = (pts) => [{ pts: H(pts), color: hairDk, alpha: .45 }];
    const jump = pose.jump || 0;
    c.save(); c.translate(pose.x, pose.y + (pose.bob || 0) * s); c.scale(1 + sq * .35, 1 - sq * .35);

    // --- ground shadow (fades with jump)
    c.save(); c.globalAlpha = .18 * (1 - jump * .6); c.fillStyle = inkC; c.beginPath(); c.ellipse(0, (1.18 + jump * .2) * s, .4 * s * (1 - jump * .3), .06 * s, 0, 0, TAU); c.fill(); c.restore();

    // --- tail
    if (spec.tail) {
      const wag = pose.tailWag || 0, sd = spec.tail.side || 1, tc = spec.tail.color || hairCol;
      const spine = [[sd * .2, .6], [sd * (.45 + wag * .05), .8 + wag * .05], [sd * (.62 + wag * .1), .6 + wag * .12], [sd * (.7 + wag * .12), .32 + wag * .2]];
      group(c, [{ pts: H(tailPts(spine, .18)), fill: tc, shade: hairShade([[sd * .1, .75], [sd * .8, .95], [sd * 1, .55], [sd * .5, .5]]) }], { lw, outline: inkC });
      if (spec.tail.inner) group(c, [{ pts: H(tuft([[sd * .58, .68], [sd * .66, .47], [sd * .72, .3]], .17, { curl: .3 })), fill: spec.tail.inner }], { lw: lw * .8, outline: inkC });
    }

    // --- back hair
    const back = [];
    for (const tf of hair.back || []) back.push({ pts: tuftH(tf, sway * .1, 1.2), fill: hairCol, shade: hairShade([[-1.2, .2], [1.2, .2], [1.2, 1.6], [-1.2, 1.6]]) });
    for (const tf of hair.side || []) back.push({ pts: tuftH(tf), fill: hairCol, shade: hairShade([[-1.2, .4], [1.2, .4], [1.2, 1.6], [-1.2, 1.6]]) });
    if (top.kind === 'hoodie') back.push({ pts: H([[-.34, .3], [-.36, .5], [-.2, .6], [.2, .6], [.36, .5], [.34, .3], [0, .2]]), fill: top.color || '#1d1d24', shade: [{ pts: H([[-1, .45], [1, .45], [1, 1], [-1, 1]]), color: '#000', alpha: .35 }] });
    group(c, back, { lw, outline: inkC });

    // --- body: local origin at the chin
    c.save(); c.translate(0, .44 * s);
    const legBend = (sd) => (sd < 0 ? pose.legL : pose.legR) ?? jump * .5;
    for (const sd of [-1, 1]) {
      const bend = legBend(sd); c.save(); c.translate(sd * .15 * s, .42 * s); c.rotate(sd * bend * .6); c.translate(0, -.42 * s);
      const legH = (bottom.legLength ?? (bottom.kind === 'jeans' ? .34 : .26)) - bend * .06;
      if (bottom.kind === 'jeans') {
        const jc = bottom.color || '#7fa6c9', jl = mixCol(jc, '#ffffff', .25), jd = mixCol(jc, '#1c2a44', .4);
        group(c, [{ pts: H([[sd * .15 - .11, .3], [sd * .15 + .11, .3], [sd * .15 + .1, .42 + legH], [sd * .15 - .1, .42 + legH]]), fill: jc, shade: [{ pts: H([[sd * .15 + .02, .2], [sd * .15 + .2, .2], [sd * .15 + .2, .9], [sd * .15 + .04, .9]]), color: jd, alpha: .5 }], light: [{ pts: H([[sd * .15 - .09, .3], [sd * .15 - .05, .3], [sd * .15 - .05, .7], [sd * .15 - .09, .7]]), color: jl, alpha: .4 }] }], { lw, outline: inkC });
        if (bottom.ripped) { // knee rip: skin patch + white thread lines
          shape(c, H(ellipsePts(sd * .15, .5, .07, .04, 10)), { fill: skin, stroke: inkC, lw: lw * .5 });
          for (let i = -1; i <= 1; i++) ink(c, H([[sd * .15 - .06, .5 + i * .02], [sd * .15 + .06, .5 + i * .02]]), lw * .35, '#eef2ff', 'inout');
        }
        // sneaker: dark upper, white sole, laces
        group(c, [{ pts: H([[sd * .15 - .12, .42 + legH], [sd * .15 + .12, .42 + legH], [sd * .15 + .14, .52 + legH, 'c'], [sd * .15 - .14, .52 + legH, 'c']]), fill: bottom.shoes || '#1a1a20' },
          { pts: H([[sd * .15 - .15, .49 + legH], [sd * .15 + .15, .49 + legH], [sd * .15 + .15, .55 + legH, 'c'], [sd * .15 - .15, .55 + legH, 'c']]), fill: '#f1f1f4' }], { lw, outline: inkC });
        for (let i = 0; i < 3; i++) ink(c, H([[sd * .15 - .05, .43 + legH + i * .02], [sd * .15 + .05, .43 + legH + i * .02]]), lw * .3, '#e5e5ee', 'inout');
      } else { // skirt + thigh-highs (default)
        const sc = bottom.socks || '#1f2029';
        group(c, [
          { pts: H(roundRectPts(sd * .15 - .075, .42, .15, legH, .05)), fill: sc, light: [{ pts: H([[sd * .15 - .06, .4], [sd * .15 - .02, .4], [sd * .15 - .02, .7], [sd * .15 - .06, .7]]), color: mixCol(sc, '#ffffff', .15), alpha: .8 }] },
          { pts: H([[sd * .15 - .1, .38 + legH], [sd * .15 + .1, .38 + legH], [sd * .15 + .11, .5 + legH, 'c'], [sd * .15 - .11, .5 + legH, 'c']]), fill: bottom.shoes || '#e9e9ef', shade: [{ pts: H([[-1, .45 + legH], [1, .45 + legH], [1, 1], [-1, 1]]), color: '#8d8da0', alpha: .6 }] },
        ], { lw, outline: inkC });
        ink(c, H([[sd * .15 - .06, .46], [sd * .15 + .06, .46]]), lw * .4, mixCol(sc, '#ffffff', .3), 'inout');
      }
      c.restore();
    }
    if (bottom.kind !== 'jeans') { // skirt (pleated) under the top
      const kc = bottom.color || '#2e3b52';
      const skirt = H([[-.32, .3], [.32, .3], [.38, .5, 'c'], [.19, .53], [0, .5], [-.19, .53], [-.38, .5, 'c']]);
      group(c, [{ pts: skirt, fill: kc, shade: [-.3, -.12, .2].map(px => ({ pts: H([[px, .2], [px + .08, .2], [px + .1, .6], [px - .02, .6]]), color: '#101522', alpha: .4 })) }], { lw, outline: inkC });
    } else if (bottom.kind === 'jeans') { // waist band
      group(c, [{ pts: H([[-.3, .3], [.3, .3], [.31, .42], [-.31, .42]]), fill: bottom.color || '#7fa6c9', shade: [{ pts: H([[0, 0], [.5, 0], [.5, 1], [0, 1]]), color: '#1c2a44', alpha: .35 }] }], { lw, outline: inkC });
    }
    // torso
    const tc = top.color || '#2b2f4a', tLt = top.light || mixCol(tc, '#ffffff', .25), tDk = top.dark || mixCol(tc, '#000000', .45);
    if (top.kind === 'jacket') { // ribbed sweater under an open jacket
      const swc = top.inner || '#8a8f9c', swd = mixCol(swc, '#000000', .3);
      group(c, [{ pts: H([[-.2, -.06], [.2, -.06], [.24, .34], [-.24, .34]]), fill: swc, shade: [{ pts: H([[.06, -.2], [.4, -.2], [.4, .5], [.1, .5]]), color: swd, alpha: .55 }] }], { lw, outline: inkC });
      for (let i = -3; i <= 3; i++) ink(c, H([[i * .05, -.02], [i * .056, .3]]), lw * .35, 'rgba(20,20,30,.35)', 'inout');
    } else { // hoodie / sweater: one torso shape
      group(c, [{ pts: H([[-.3, -.08], [.3, -.08], [.36, .46, 'c'], [-.36, .46, 'c']]), fill: tc, shade: [{ pts: H([[.12, -.2], [.5, -.2], [.5, .6], [.16, .6]]), color: tDk, alpha: .45 }], light: [{ pts: H([[-.3, -.08], [-.2, -.08], [-.2, .4], [-.3, .4]]), color: tLt, alpha: .3 }] }], { lw, outline: inkC });
      if (top.kind === 'hoodie') { // kangaroo pocket, zip, drawstrings
        ink(c, H([[-.22, .2], [-.24, .44]]), lw * .5, tLt, 'inout'); ink(c, H([[.22, .2], [.24, .44]]), lw * .5, tLt, 'inout');
        ink(c, H([[0, -.04], [0, .46]]), lw * .7, top.zip || '#c9cbd6', 'none');
        for (const sd of [-1, 1]) ink(c, H([[sd * .08, -.06], [sd * .1, .1], [sd * .06, .22]]), lw * .45, top.string || '#e8e8ee', 'none');
      }
    }
    // sleeves: pivot at the shoulder; a (radians) 0 = hanging, positive = raised outward
    const raised = [];
    const sleeve = (sd, a) => {
      c.save(); c.translate(sd * .28 * s, -.02 * s); c.rotate(-sd * (.1 + a)); if (a > 1.1) c.scale(1, .72);
      const poly = H([[sd * -.1, -.02], [sd * .08, -.06], [sd * .16, .2], [sd * .14, .52], [sd * -.09, .54], [sd * -.13, .25]]);
      group(c, [{ pts: poly, fill: tc, shade: [{ pts: H([[sd * .06, -.2], [sd * .4, -.2], [sd * .4, .9], [sd * .08, .9]]), color: tDk, alpha: .45 }], light: [{ pts: H([[sd * -.12, .0], [sd * -.06, .0], [sd * -.04, .5], [sd * -.11, .5]]), color: tLt, alpha: .35 }] }], { lw, outline: inkC });
      for (let i = 0; i < 3; i++) ink(c, H([[sd * -.1, .47 + i * .02], [sd * .14, .46 + i * .02]]), lw * .3, 'rgba(255,255,255,.18)', 'inout');
      if (sd === 1 && top.badge) shape(c, H(roundRectPts(.03, .12, .09, .08, .015)), { fill: '#e8e8ec', stroke: inkC, lw: lw * .45 });
      if (a > .4 || pose.fists) { c.translate(sd * .02 * s, .56 * s); if (a > 1.1) c.scale(1, 1 / .72); group(c, [{ pts: H(circlePts(0, 0, .085, 10)), fill: skin, shade: [{ pts: H([[-.1, .02], [.1, .02], [.1, .2], [-.1, .2]]), color: '#e0b29c', alpha: .5 }] }], { lw: lw * .8, outline: inkC }); ink(c, H([[-.06, -.02], [.06, -.02]]), lw * .3, '#c98f78', 'inout'); }
      c.restore();
    };
    // arms raised above the shoulder are drawn after the head (they pass in front of the hair)
    for (const [sd, a] of [[-1, pose.armL || 0], [1, pose.armR || 0]]) { if (a > 1.1) raised.push([sd, a]); else sleeve(sd, a); }
    if (top.kind === 'jacket') for (const sd of [-1, 1]) {
      const front = H([[sd * .06, -.1], [sd * .28, -.1], [sd * .36, .12], [sd * .34, .38, 'c'], [sd * .12, .4], [sd * .1, .1]]);
      group(c, [{ pts: front, fill: tc, shade: [{ pts: H([[sd * .2, -.2], [sd * .5, -.2], [sd * .5, .5], [sd * .26, .5]]), color: tDk, alpha: .45 }], light: [{ pts: H([[sd * .06, -.1], [sd * .12, -.1], [sd * .14, .4], [sd * .1, .4]]), color: tLt, alpha: .55 }] }], { lw, outline: inkC });
    }
    // collar: chunky turtleneck (jacket) or hood rim (hoodie)
    if (top.kind === 'jacket') {
      const swd = mixCol(top.inner || '#8a8f9c', '#000000', .3);
      group(c, [{ pts: H([[-.3, -.2], [-.12, -.25], [.12, -.25], [.3, -.2], [.32, .04], [0, .1], [-.32, .04]]), fill: swd, shade: [{ pts: H([[-.4, -.1], [.4, -.1], [.4, .3], [-.4, .3]]), color: '#3a3d48', alpha: .5 }] }], { lw, outline: inkC });
      for (let i = -4; i <= 4; i++) ink(c, H([[i * .065, -.22], [i * .068, .05]]), lw * .4, 'rgba(20,20,30,.4)', 'inout');
    } else if (top.kind === 'hoodie') {
      group(c, [{ pts: H([[-.3, -.12], [0, -.02], [.3, -.12], [.3, .0], [0, .1], [-.3, .0]]), fill: tLt, shade: [{ pts: H([[-.5, -.06], [.5, -.06], [.5, .3], [-.5, .3]]), color: tDk, alpha: .4 }] }], { lw, outline: inkC });
    }
    c.restore(); // body

    // --- head (pivot at the neck)
    c.save(); c.translate(0, .45 * s); c.rotate(tl); c.translate(0, -.45 * s);
    const face = H([[0, -.5], [.3, -.44], [.5, -.12], [.47, .22], [.28, .45], [0, .5], [-.28, .45], [-.47, .22], [-.5, -.12], [-.3, -.44]]);
    group(c, [{ pts: H([[-.08, .3], [.08, .3], [.1, .5], [-.1, .5]]), fill: skin, shade: [{ pts: H([[-.2, .3], [.2, .3], [.2, .48], [-.2, .48]]), color: '#e0b29c', alpha: .5 }] },
      { pts: face, fill: skin, shade: [{ pts: H([[-.6, -.6], [.6, -.6], [.6, -.02], [.3, .02], [0, -.02], [-.3, .02], [-.6, -.02]]), color: '#e9bfa9', alpha: .55 }] }], { lw: lw * 1.1, outline: inkC });
    // face
    const bl = pose.blush ?? 0; if (bl > 0) for (const sd of [-1, 1]) blush(c, sd * .3 * s, .27 * s, .085 * s, spec.blushColor || '#f39a8f', .45 * bl, spec.blushLines !== false);
    const eyeY = .2 * s, eyeX = (spec.eyeSpacing ?? .21) * s, ew = (spec.eyeWidth ?? .2) * s, eh = (spec.eyeHeight ?? .19) * s;
    for (const sd of [-1, 1]) {
      c.save(); c.translate(sd * eyeX, eyeY);
      const st = Array.isArray(pose.eyes) ? pose.eyes[sd < 0 ? 0 : 1] : (pose.eyes || 'round');
      const op = Array.isArray(pose.eyeOpen) ? pose.eyeOpen[sd < 0 ? 0 : 1] : (pose.eyeOpen ?? 1);
      animeEye(c, ew, eh, { style: st, open: op, iris: spec.iris || '#3ec7c0', look: pose.look, side: sd, ink: inkC, lash: spec.lash ?? .6, brow: pose.brow ? { y: pose.brow.y ?? .55, angle: pose.brow.angle || 0, w: 1.6, color: spec.browColor } : null });
      c.restore();
    }
    c.save(); c.translate(0, .37 * s);
    mouth(c, pose.mouthPts || mouthPts(pose.mouth || 'smile'), (spec.mouthWidth ?? .11) * s, { fang: pose.fang, teeth: pose.teeth, ink: inkC });
    c.restore();
    // bangs over a hair cap
    const bangShapes = [{ pts: H(hair.cap), fill: hairCol }];
    for (const tf of hair.bangs || []) bangShapes.push({ pts: tuftH(tf), fill: hairCol, shade: hairShade([[-1, -.1], [1, -.1], [1, 1], [-1, 1]]) });
    group(c, bangShapes, { lw, outline: inkC });
    if (hair.highlight) ink(c, H([[-.32, -.42], [-.1, -.5], [.15, -.48]]), s * .045, hairLt, 'inout');
    for (const st of hair.streaks || []) ink(c, H(st.spine), s * st.w, st.color || hairDk, 'inout');
    // hat
    if (spec.hat && spec.hat.kind === 'cap') {
      const hc = spec.hat.color || '#222228', bc = spec.hat.brim || '#c2323c';
      const dome = [[-.58, -.3], [-.5, -.62], [-.2, -.78], [.2, -.78], [.5, -.62], [.58, -.3], [.3, -.36], [0, -.38], [-.3, -.36]];
      group(c, [{ pts: H(dome), fill: hc, shade: [{ pts: H([[.1, -1], [1, -1], [1, 0], [.2, 0]]), color: '#000', alpha: .35 }], light: [{ pts: H([[-.5, -.7], [-.2, -.8], [-.15, -.5], [-.45, -.4]]), color: '#55555f', alpha: .35 }] },
        { pts: H([[-.66, -.3], [-.4, -.4], [0, -.44], [.4, -.4], [.66, -.3], [.4, -.2], [0, -.16], [-.4, -.2]]), fill: bc, shade: [{ pts: H([[-1, -.3], [1, -.3], [1, 0], [-1, 0]]), color: '#000', alpha: .3 }] }], { lw, outline: inkC });
      for (const x of [-.25, 0, .25]) ink(c, H([[x * .6, -.76], [x, -.4]]), lw * .35, 'rgba(0,0,0,.45)', 'inout');
      ink(c, H([[-.06, -.82], [.06, -.82]]), lw * 1.6, hc, 'none'); // button
    }
    // ahoge
    if (hair.ahoge) group(c, [{ pts: tuftH(hair.ahoge, 0, .2), fill: hairCol }], { lw: lw * .9, outline: inkC });
    // ears (on top of hair and hat, like the references)
    const e = spec.ears;
    if (e) for (const sd of [-1, 1]) {
      const tw = 1 + sway * .06 * sd, tip = e.tip || [.74, -1.0], tw2 = (pose.earTwitch || 0) * sd;
      const outer = [[sd * .14, -.52], [sd * .3, -.72], [sd * tip[0] * tw + tw2 * .1, tip[1] + Math.abs(tw2) * .15, 'c'], [sd * .56, -.5], [sd * .5, -.3]];
      const inner = [[sd * .26, -.52], [sd * .36, -.66], [sd * (tip[0] - .1) * tw + tw2 * .08, tip[1] + .17 + Math.abs(tw2) * .12, 'c'], [sd * .5, -.46], [sd * .46, -.36]];
      group(c, [{ pts: H(outer), fill: e.color || hairCol, shade: hairShade([[sd * .35, -1.3], [sd * 1.2, -1.3], [sd * 1.2, -.1], [sd * .5, -.1]]) },
        { pts: H(inner), fill: e.inner || '#f3f0ee', shade: [{ pts: H([[sd * .42, -1.2], [sd * 1, -1.2], [sd * 1, -.2], [sd * .55, -.3]]), color: '#c9c3c0', alpha: .5 }] }], { lw, outline: inkC });
      ink(c, H([[sd * .3, -.55], [sd * .36, -.62]]), lw * .45, '#b9b3b0', 'inout');
    }
    // accessories
    if (spec.hairclip) { const sd = spec.hairclip.side || -1; c.save(); c.translate(sd * .34 * s, -.12 * s); c.rotate(sd * .5); shape(c, H(roundRectPts(-.06, -.02, .12, .04, .01)), { fill: spec.hairclip.color || '#e9e9ef', stroke: inkC, lw: lw * .5 }); c.restore(); }
    if (pose.emote) emote(c, pose.emote.kind, (pose.emote.x ?? .55) * s, (pose.emote.y ?? -.55) * s, (pose.emote.s ?? .16) * s, pose.emote.age ?? 1, pose.emote.color);
    c.restore(); // head
    if (raised.length) { c.save(); c.translate(0, .44 * s); for (const [sd, a] of raised) sleeve(sd, a); c.restore(); }
    c.restore();
  }

  Object.assign(window, { chibi, CHIBI: { hairSpec, DEFAULT_HAIR, HAIR_LONG, HAIR_PONYTAIL, AHOGE_LOOP, AHOGE_SPIKE } });
})();
