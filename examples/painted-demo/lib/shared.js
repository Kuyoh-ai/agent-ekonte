// shared.js: a tiny rig in the painted style — a round critter with pose and face parameters.
// critter(x, y, s, o): (x, y) = ground point, s = size unit. o: { squash, lean, eyes: 'open'|'closed'|'happy', col }
function critter(x, y, s, o = {}) {
  const sq = o.squash || 0, col = o.col || PAL.clay;
  push(); translate(x, y); rotate(o.lean || 0); scale(1 + sq * .25, 1 - sq * .25);
  paint(ellPts(0, 6, s * 1.1, s * .22, 20, 1), { wash: PAL.ink, washOp: 40, ink: null });                    // shadow
  paint(ellPts(0, -s, s, s * .95, 30, s * .02), { wash: col, fill: PAL.clayDk, fillOp: 60, tex: .5, ink: PAL.ink, sw: 1.3 });
  paint(ellPts(-s * .35, -s * .55, s * .35, s * .22, 18, 1), { wash: PAL.clayLt, washOp: 150, ink: null }); // belly light
  for (const ex of [-.32, .32]) {
    if (o.eyes === 'closed') inkLine([[s * ex - s * .12, -s * 1.15], [s * ex + s * .12, -s * 1.15]], 1.2);
    else if (o.eyes === 'happy') inkLine([[s * ex - s * .12, -s * 1.1], [s * ex, -s * 1.22], [s * ex + s * .12, -s * 1.1]], 1.2);
    else paint(ellPts(s * ex, -s * 1.15, s * .07, s * .12, 12), { wash: PAL.ink, ink: null });
  }
  pop();
}

// Model sheet: node engine/render.mjs --project=examples/painted-demo --sheet=0,0.3,0.6 --test=cast
VIDEO.test('cast', painted((t) => {
  const W = VIDEO.W, H = VIDEO.H;
  ['open', 'closed', 'happy'].forEach((eyes, i) => critter(W * (.25 + i * .25), H * .7, 70, { eyes, squash: Math.sin(t * 6 + i) * .3, lean: (i - 1) * .12 }));
  letter('critter — model sheet', W / 2, H * .15, 44, PAL.cream);
}));
