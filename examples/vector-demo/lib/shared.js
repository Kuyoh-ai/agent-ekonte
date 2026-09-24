// shared.js: character specs written as RATIOS (no coordinates) + parameter sweeps that validate the part formulas.
// See engine/VECTOR_GUIDE.md for what each ratio means and the ranges that stay cute.

// 1: cat-eared girl, light-teal hair with blue streaks, ponytail right, ahoge loop, big dark jacket over a grey
//    turtleneck, dark pleated skirt, black thigh-highs, white shoes.
const AOI = {
  name: 'aoi', skin: '#fde5d3',
  head: { cheek: .6, chin: .2, jaw: .72 },
  eyes: { y: .64, spacing: .23, size: .27, aspect: 1, iris: '#3ec7c0', lash: .7 },
  mouth: { y: .84, width: .11 },
  hair: { color: '#6fd3e6', dark: '#2f6bb4', light: '#bff0f7', volume: .12,
    bangs: { n: 6, part: -.35, hairline: .3, length: .17, curl: .3, seed: 4 },
    side: { n: 2, length: .9, width: .24, curl: .2 },
    back: { style: 'ponytail', length: .6, side: 1 }, ahoge: { kind: 'loop' },
    streaks: [{ spine: [[-.18, -.2], [-.2, .0], [-.13, .12]], w: .035 }, { spine: [[.2, -.22], [.22, .0], [.27, .1]], w: .03 }] },
  ears: { size: .5, at: .78, tilt: .3, width: .3, inner: '#f3f0ee' },
  tail: { color: '#6fd3e6', inner: '#d8f4f8', side: 1 },
  body: { heads: 1.85, torsoWidth: .62, top: { kind: 'jacket', color: '#2b2f4a', light: '#5a5f86', inner: '#8a8f9c', badge: true }, bottom: { kind: 'skirt', color: '#2e3b52', socks: '#1f2029', shoes: '#e9e9ef' } },
};
// 2: cat-eared girl, long teal hair, black cap with red brim, white hair clip, black hoodie, ripped jeans, sneakers.
const MIKU = {
  name: 'miku', skin: '#fde5d3',
  head: { cheek: .6, chin: .2, jaw: .72 },
  eyes: { y: .66, spacing: .23, size: .27, aspect: 1.05, iris: '#3fd0b8', lash: .8 },
  mouth: { y: .84, width: .11 },
  hair: { color: '#4fc9c4', dark: '#237f86', light: '#b8f0ea', volume: .1, highlight: false,
    bangs: { n: 5, part: .25, hairline: .32, length: .16, curl: .2, seed: 7 },
    side: { n: 2, length: 1.3, width: .26, curl: .15 },
    back: { style: 'long', length: .6, volume: .12 } },
  ears: { size: .5, at: .78, tilt: .35, width: .3, inner: '#f3f0ee' },
  tail: { color: '#4fc9c4', side: 1 },
  hat: { kind: 'cap', color: '#25252c', brim: '#c2323c', y: .2 },
  hairclip: { side: -1, color: '#e9e9ef' },
  body: { heads: 2.0, torsoWidth: .62, top: { kind: 'hoodie', color: '#1d1d24', light: '#3a3a46', string: '#e8e8ee', zip: '#c9cbd6' }, bottom: { kind: 'jeans', color: '#8fb4d4', ripped: true, shoes: '#1a1a20', sole: '#f1f1f4' } },
};

const white = () => { const c = VIDEO.ctx; c.fillStyle = '#fff'; c.fillRect(0, 0, VIDEO.W, VIDEO.H); return c; };
const label = (c, txt, x, y) => { c.fillStyle = '#333'; c.font = `${Math.round(VIDEO.W * .016)}px system-ui`; c.textAlign = 'center'; c.fillText(txt, x, y); };

// --- sweeps: each cell varies two ratios so the formula can be judged across its range
// head: chin (columns) × cheek (rows)
VIDEO.test('sweep-head', () => {
  const c = white(), W = VIDEO.W, s = W * .13;
  [.5, .58, .66].forEach((cheek, r) => [0, .3, .6, 1].forEach((chin, k) => {
    const x = W * (.14 + k * .24), y = W * (.18 + r * .3);
    group(c, [{ pts: PARTS.head({ cheek, chin, jaw: .65 }).map(p => ({ x: x + p.x * s, y: y + p.y * s })), fill: '#fde5d3' }], { lw: s * .024 });
    for (const sd of [-1, 1]) { c.save(); c.translate(x + sd * .22 * s, y + .14 * s); animeEye(c, .2 * s, .19 * s, { side: sd }); c.restore(); }
    c.save(); c.translate(x, y + .34 * s); mouth(c, mouthPts('smile'), .11 * s, {}); c.restore();
    label(c, `chin ${chin} cheek ${cheek}`, x, y + .72 * s);
  }));
});
// bangs: n (columns) × curl (rows); side locks and volume fixed
VIDEO.test('sweep-bangs', () => {
  const c = white(), W = VIDEO.W, s = W * .13;
  [0, .3, .6].forEach((curl, r) => [3, 5, 7, 9].forEach((n, k) => {
    const x = W * (.14 + k * .24), y = W * (.2 + r * .3);
    const spec = { ...AOI, hair: { ...AOI.hair, bangs: { n, curl, part: -.3, length: .36, seed: 4 }, back: { style: 'bob' }, streaks: [] }, ears: null, tail: null, body: { ...AOI.body, heads: 1.5 } };
    chibi(c, spec, { x, y, s, eyes: 'round', mouth: 'smile', blush: .4 });
    label(c, `n ${n} curl ${curl}`, x, y + 1.3 * s);
  }));
});
// eyes: size (columns) × y position (rows)
VIDEO.test('sweep-eyes', () => {
  const c = white(), W = VIDEO.W, s = W * .13;
  [.58, .64, .7].forEach((yy, r) => [.15, .2, .25, .3].forEach((size, k) => {
    const x = W * (.14 + k * .24), y = W * (.2 + r * .3);
    const spec = { ...AOI, eyes: { ...AOI.eyes, size, y: yy }, hair: { ...AOI.hair, back: { style: 'bob' }, streaks: [] }, ears: null, tail: null, body: { ...AOI.body, heads: 1.5 } };
    chibi(c, spec, { x, y, s, eyes: 'round', mouth: 'smile', blush: .4 });
    label(c, `size ${size} y ${yy}`, x, y + 1.3 * s);
  }));
});
// ears: size (columns) × at/angle (rows)
VIDEO.test('sweep-ears', () => {
  const c = white(), W = VIDEO.W, s = W * .13;
  [.35, .5, .65].forEach((at, r) => [.4, .55, .7, .85].forEach((size, k) => {
    const x = W * (.14 + k * .24), y = W * (.22 + r * .3);
    const spec = { ...AOI, ears: { ...AOI.ears, size, at }, hair: { ...AOI.hair, back: { style: 'bob' }, streaks: [] }, tail: null, body: { ...AOI.body, heads: 1.5 } };
    chibi(c, spec, { x, y, s, eyes: 'round', mouth: 'smile', blush: .4 });
    label(c, `size ${size} at ${at}`, x, y + 1.3 * s);
  }));
});
// body: heads (columns) × torso width (rows)
VIDEO.test('sweep-body', () => {
  const c = white(), W = VIDEO.W, s = W * .11;
  [.5, .6, .72].forEach((tw, r) => [1.6, 1.9, 2.2, 2.6].forEach((heads, k) => {
    const x = W * (.14 + k * .24), y = W * (.16 + r * .3);
    chibi(c, { ...AOI, body: { ...AOI.body, heads, torsoWidth: tw }, ears: null, tail: null, hair: { ...AOI.hair, back: { style: 'bob' } } }, { x, y, s, eyes: 'round', mouth: 'smile', blush: .4 });
    label(c, `heads ${heads} torso ${tw}`, x, y + (heads - .3) * s);
  }));
});
// full characters, several expressions
VIDEO.test('cast', (t) => {
  const c = white(), W = VIDEO.W, H = VIDEO.H;
  const poses = [
    { eyes: 'xx', mouth: 'shout', brow: { angle: .3 }, blush: 1, squash: -.03, emote: { kind: 'shout', x: -.75, y: -.1, s: .2, color: '#f0a030' } },
    { eyes: 'round', mouth: 'smile', look: [.3, 0], blush: .5 },
    { eyes: ['round', 'happy'], mouth: 'grin', fang: 1, blush: .6, emote: { kind: 'sparkle', x: .7, y: -.7, s: .14 } },
    { eyes: 'happy', mouth: 'cat', blush: .8, emote: { kind: 'note', x: .75, y: -.6, s: .18 } },
  ];
  poses.forEach((p, i) => chibi(c, AOI, { x: W * (.25 + (i % 2) * .5), y: H * (.2 + Math.floor(i / 2) * .5), s: W * .21, ...p }));
});
VIDEO.test('cast2', () => {
  const c = white(), W = VIDEO.W, H = VIDEO.H;
  chibi(c, MIKU, { x: W * .28, y: H * .38, s: W * .22, eyes: ['round', 'happy'], mouth: 'grin', fang: 1, blush: .6, armL: 2.4, armR: 2.2, fists: true, jump: 1, tilt: -.12, hairSway: .4, tailWag: .6, emote: { kind: 'lines', x: -.9, y: -.7, s: .2 } });
  chibi(c, MIKU, { x: W * .72, y: H * .38, s: W * .22, eyes: 'round', mouth: 'smile', blush: .3, look: [-.4, .1], emote: { kind: 'q', x: .7, y: -.8, s: .18 } });
});
// judge sheets: one character, the pose of the reference image, large (used by the external judge loop)
VIDEO.test('judge1', () => { const c = white(), W = VIDEO.W, H = VIDEO.H; chibi(c, AOI, { x: W * .5, y: H * .4, s: W * .36, eyes: 'xx', mouth: 'yell', brow: { angle: .3 }, blush: 1, squash: -.02, emote: { kind: 'shout', x: -.78, y: -.1, s: .2, color: '#f0a030' } }); });
VIDEO.test('judge2', () => { const c = white(), W = VIDEO.W, H = VIDEO.H; chibi(c, MIKU, { x: W * .5, y: H * .4, s: W * .34, eyes: ['round', 'happy'], mouth: 'grin', fang: 1, blush: .6, armL: 2.4, armR: 2.2, fists: true, jump: 1, tilt: -.12, hairSway: .4, tailWag: .6, emote: { kind: 'lines', x: -.9, y: -.7, s: .2 } }); });
