// intro.js: one chapter, three shots that exercise the chibi rig: idle acting, a morphing shout, a jump.
(() => {
  const bg = (c, t, a = '#fbfbfd', b = '#e9f3fb') => { const W = VIDEO.W, H = VIDEO.H; gradientRect(c, 0, 0, W, H, [a, b], Math.PI / 2 + Math.sin(t * .3) * .2); };
  // s01: idle. Blink, breathe, look around, hair and tail follow with a lag.
  function s01(t, lt, dur) {
    const c = VIDEO.ctx, W = VIDEO.W, H = VIDEO.H; bg(c, t);
    const id = idle(lt, 1, .55);
    const lookX = kf(lt, [[0, 0], [.6, 0], [1.0, -.7], [1.8, -.7], [2.2, .6], [2.8, .6], [3.2, 0]], easeInOut);
    const grin = kf(lt, [[2.6, 0], [3.0, 1]], backOut);
    const mp = morph(mouthPts('smile'), mouthPts('grin'), grin);
    chibi(c, AOI, { x: W / 2, y: H * .42, s: W * .42, bob: id.dy / 40, tilt: id.tilt + lookX * .05, squash: id.squash,
      eyes: grin > .5 ? ['round', 'happy'] : 'round', eyeOpen: blinkOpen(lt, 2.9), look: [lookX, .1], mouthPts: mp, fang: grin > .5 ? 1 : 0,
      blush: .4 + grin * .4, hairSway: follow(x => Math.sin(x * 2.2) * .3, lt, .1) + lookX * .25, tailWag: Math.sin(lt * 3) * (.5 + grin), earTwitch: grin > .5 ? Math.sin(lt * 12) * .6 : 0 });
  }
  // s02: anticipation (squash, eyes shut) → shout with > < eyes; the mouth morphs smile → shout, shout marks pop.
  function s02(t, lt, dur) {
    const c = VIDEO.ctx, W = VIDEO.W, H = VIDEO.H; bg(c, t, '#fff4ec', '#ffe3d1');
    const antic = seg(lt, 0, .35), hit = seg(lt, .35, .5), k = backOut(hit);
    const mp = morph(mouthPts('smile'), mouthPts('shout'), k);
    const sq = antic < 1 ? -ease(antic) * .12 : .12 * (1 - k) - .04 * Math.sin(lt * 20) * (hit >= 1 ? Math.exp(-(lt - .5) * 3) : 0);
    const [sx, sy] = hit > 0 && hit < 1 ? shake(lt, 10) : [0, 0];
    cam2d(c, W / 2 + sx, H / 2 + sy, 1 + .06 * k, 0);
    chibi(c, AOI, { x: W / 2, y: H * .42, s: W * .42, squash: sq, eyes: hit > 0 ? 'xx' : 'round', eyeOpen: 1 - antic, brow: { angle: .3 },
      mouthPts: mp, blush: .3 + k * .7, tilt: -.05 * k, hairSway: -k * .6 + Math.sin(lt * 9) * .15 * k, tailWag: k, armL: k * .35, armR: k * .35,
      emote: hit > 0 ? { kind: 'shout', x: -.78, y: -.1, s: .22, color: '#f0a030', age: lt - .35 } : null });
    cam2dEnd(c);
    if (hit > 0 && hit < 1) { c.fillStyle = 'rgba(255,255,255,.6)'; c.globalAlpha = 1 - hit; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
  }
  // s03: character 2 jumps in from the right, fists up; lands with squash; wink.
  function s03(t, lt, dur) {
    const c = VIDEO.ctx, W = VIDEO.W, H = VIDEO.H; bg(c, t, '#eef9f7', '#d8f1ec');
    const p = seg(lt, 0, 1.1), air = Math.sin(p * Math.PI), x = lerp(W * 1.2, W * .5, easeOut(p)), land = seg(lt, 1.1, 1.35);
    const sq = p < 1 ? -air * .12 : .16 * (1 - backOut(land));
    const arm = p < 1 ? 2.3 : lerp(2.3, 0, ease(land));
    chibi(c, MIKU, { x, y: H * .5 - air * H * .16, s: W * .36, squash: sq, jump: air, tilt: -.15 * air, armL: arm, armR: arm, fists: true,
      eyes: land > 0 ? ['round', 'happy'] : 'round', eyeOpen: 1, mouth: land > 0 ? 'grin' : 'o', fang: land > 0 ? 1 : 0, blush: .6, look: [-.3 * (1 - land), 0],
      hairSway: air * .8, tailWag: Math.sin(lt * 5), emote: land > 0 ? { kind: 'sparkle', x: .7, y: -.75, s: .16, age: lt - 1.1 } : null });
    if (p < 1) for (const [i, y] of [[0, .3], [1, .38], [2, .46]]) ink(c, [[x + W * (.3 + i * .05), H * y], [x + W * (.5 + i * .08), H * (y + .02)]], 6, 'rgba(30,30,40,.35)', 'inout');
  }
  VIDEO.chapter('intro', 0, 8, [[0, s01, 's01'], [3.4, s02, 's02'], [5.4, s03, 's03']]);
})();
