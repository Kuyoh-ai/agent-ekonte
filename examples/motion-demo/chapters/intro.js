// intro.js: layered parallax dusk with drifting lanterns and a title pop — the kind of depth a flat shot lacks.
(() => {
  function dusk(t, lt, dur) {
    const c = VIDEO.ctx, W = VIDEO.W, H = VIDEO.H, camX = lerp(0, 160, easeInOut(lt / dur)), [sx, sy] = shake(t, lt > 2 && lt < 2.25 ? 6 : 0);
    gradientRect(c, 0, 0, W, H, [PAL.deep, PAL.dusk, PAL.rose, PAL.peach]);
    glow(c, W * .7 - camX * .1, H * .62, H * .5, PAL.sun, .9);
    const hills = [[PAL.hill3, .8, .55, 3], [PAL.hill2, .5, .66, 7], [PAL.hill1, .15, .78, 11]];
    for (const [col, d, base, seed] of hills) {
      const [ox] = parallax(-camX, 0, d);
      shape(c, cx => { cx.beginPath(); cx.moveTo(-100, H); for (let x = -100; x <= W + 200; x += 60) cx.lineTo(x + ox, H * base - 40 * Math.sin(x * .004 + seed) - 30 * hash(Math.round(x / 60) + seed)); cx.lineTo(W + 200, H); cx.closePath(); },
        { fill: haze(col, PAL.rose, d * .5), texture: .25, textureKind: 'paper' });
    }
    cam2d(c, W / 2 + sx, H / 2 + sy, lerp(1, 1.06, lt / dur));
    for (const p of particles(26, t, { life: 3.2, gravity: -18, spawn: (i, g) => ({ x: W * hash(i * 3 + g), y: H * (.75 + .2 * hash(i + g * 5)), vx: 12 * (hash(i + 2) - .5), vy: -60 - 40 * hash(i * 9 + g) }) })) {
      const a = Math.sin(p.k * Math.PI);
      glow(c, p.x, p.y, 26, PAL.sun, .5 * a);
      shape(c, cx => { cx.beginPath(); cx.roundRect(p.x - 7, p.y - 10, 14, 20, 5); }, { fill: mixCol(PAL.peach, PAL.sun, a) });
    }
    cam2dEnd(c);
    popText(c, 'Good night', W / 2, H * .32, 96, '#fff', lt - .8, { outline: PAL.dusk, font: 'Georgia, serif', weight: 700 });
    if (lt > dur - .5) wipe(c, seg(lt, dur - .5, dur) * .5, [PAL.rose, PAL.deep]);
  }
  VIDEO.chapter('intro', 0, 4, [[0, dusk, 's01']]);
})();
