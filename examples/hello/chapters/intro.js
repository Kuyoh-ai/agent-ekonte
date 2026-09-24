// intro.js: two shots showing the runtime contract.
(() => {
  function sunrise(t, lt, dur) {
    const c = VIDEO.ctx, W = VIDEO.W, H = VIDEO.H, k = easeOut(lt / dur);
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, mixCol(PAL.night, PAL.sky, k)); g.addColorStop(1, PAL.cream);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    disc(c, W / 2, lerp(H * .9, H * .42, k), H * .16 * (1 + .05 * wob(t, 1.5)), PAL.sun);
    for (let i = 0; i < 12; i++) disc(c, hash(i) * W, (hash(i + 40) * H * .5 + lt * 40 * (1 + hash(i + 9))) % H, 4 + jit(1.5), PAL.cream);
  }
  function bounce(t, lt, dur) {
    const c = VIDEO.ctx, W = VIDEO.W, H = VIDEO.H;
    c.fillStyle = PAL.cream; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 5; i++) {
      const ph = frac(lt * 1.2 + i * .13), y = H * .75 - Math.abs(Math.sin(ph * Math.PI)) * H * .45;
      disc(c, W * (.2 + i * .15), y, H * .06 * backOut(seg(lt, i * .1, i * .1 + .4)), [PAL.coral, PAL.sun, PAL.sky, PAL.night, PAL.coral][i]);
    }
  }
  VIDEO.chapter('intro', 0, 6, [[0, sunrise, 's01'], [3, bounce, 's02']]);
})();
