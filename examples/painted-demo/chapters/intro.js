// intro.js: one painted shot exercising the kit (camera push, boil, squash on beats, sfx, wipe out).
(() => {
  function meadow(t, lt, dur) {
    const W = VIDEO.W, H = VIDEO.H, [sx, sy] = shakeXY(t, lt > 2 && lt < 2.3 ? 8 : 0);
    camBegin(W / 2 + sx, H / 2 + sy, lerp(1, 1.15, easeInOut(lt / dur)), 0);
    paint(rectPts(-100, -100, W + 200, H * .62 + 100), { wash: PAL.sky, fill: PAL.teal, fillOp: 60, bleed: .2, tex: .6, ink: null });
    paint(ellPts(W * .78, H * .22, 70, 70, 26, 2), { wash: PAL.ochre, fill: PAL.cream, fillOp: 90, ink: null });
    for (let i = 0; i < 4; i++) paint(ellPts(W * (.1 + i * .28) + (lt * 30 * (1 + i * .3)) % 120, H * (.12 + .06 * (i % 2)), 90, 30, 18, 3), { wash: PAL.cream, washOp: 220, ink: PAL.ink, sw: .6 });
    paint(rectPts(-100, H * .6, W + 200, H * .5, 6), { wash: PAL.sap, fill: '#4F7F3E', fillOp: 90, tex: .7, ink: PAL.ink, sw: .8 });
    const hop = Math.abs(Math.sin(lt * Math.PI * 1.5)), land = 1 - hop;
    critter(W * (.3 + .12 * lt), H * .72 - hop * 120, 60, { squash: land > .85 ? (land - .85) * 4 : -hop * .2, lean: Math.sin(lt * 4) * .1, eyes: lt > 2 && lt < 2.4 ? 'closed' : lt > 2.4 ? 'happy' : 'open' });
    camEnd();
    sfx('BOING!', W * .62, H * .3, 90, PAL.rose, lt - 2, { life: 1 });
    if (lt > dur - .6) brushWipe(seg(lt, dur - .6, dur) * .5, PAL.indigo, PAL.violet);
  }
  VIDEO.chapter('intro', 0, 4, [[0, painted(meadow), 's01']]);
})();
