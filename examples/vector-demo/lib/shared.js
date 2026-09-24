// shared.js: the two chibi specs of this demo (written from a text brief; see engine/VECTOR_GUIDE.md) + model sheets.

// 1: "cat-eared girl with light-teal hair (blue streaks), ponytail on the right, ahoge loop, big dark oversized jacket
//     over a grey ribbed turtleneck, dark pleated skirt, black thigh-highs, white shoes. Shouting with > < eyes."
const AOI = {
  name: 'aoi', skin: '#fde5d3', hairColor: '#6fd3e6', hairDark: '#2f6bb4', hairLight: '#bff0f7', iris: '#3ec7c0',
  hair: { ponytail: true, ahoge: 'loop' },
  ears: { kind: 'cat', inner: '#f3f0ee', tip: [.74, -1.0] },
  tail: { color: '#6fd3e6', inner: '#bff0f7', side: 1 },
  top: { kind: 'jacket', color: '#2b2f4a', light: '#5a5f86', inner: '#8a8f9c', badge: true },
  bottom: { kind: 'skirt', color: '#2e3b52', socks: '#1f2029', shoes: '#e9e9ef' },
};
// 2: "cat-eared girl with long teal hair, black cap with red brim (ears poke through), white hair clip, black hoodie
//     with white drawstrings, ripped light jeans, black sneakers with white soles, teal tail. Winking, fang, fists up."
const MIKU = {
  name: 'miku', skin: '#fde5d3', hairColor: '#4fc9c4', hairDark: '#237f86', hairLight: '#b8f0ea', iris: '#3fd0b8',
  hair: { preset: 'long', ahoge: null, highlight: false, streaks: [] },
  ears: { kind: 'cat', inner: '#f3f0ee', tip: [.7, -1.02] },
  tail: { color: '#4fc9c4', side: 1 },
  hat: { kind: 'cap', color: '#25252c', brim: '#c2323c' },
  hairclip: { side: -1, color: '#e9e9ef' },
  top: { kind: 'hoodie', color: '#1d1d24', light: '#3a3a46', string: '#e8e8ee', zip: '#c9cbd6' },
  bottom: { kind: 'jeans', color: '#8fb4d4', ripped: true, shoes: '#1a1a20' },
};

// Model sheet of expressions (character 1): node engine/render.mjs --project=examples/vector-demo --sheet=0 --test=cast --cols=1
VIDEO.test('cast', (t) => {
  const c = VIDEO.ctx, W = VIDEO.W, H = VIDEO.H;
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
  const poses = [
    { eyes: 'xx', mouth: 'shout', brow: { angle: .3 }, blush: 1, squash: -.03, emote: { kind: 'shout', x: -.75, y: -.1, s: .2, color: '#f0a030' } },
    { eyes: 'round', mouth: 'smile', look: [.3, 0], blush: .5 },
    { eyes: ['round', 'happy'], mouth: 'grin', fang: 1, blush: .6, emote: { kind: 'sparkle', x: .7, y: -.7, s: .14 } },
    { eyes: 'happy', mouth: 'cat', blush: .8, emote: { kind: 'note', x: .75, y: -.6, s: .18 } },
  ];
  poses.forEach((p, i) => chibi(c, AOI, { x: W * (.25 + (i % 2) * .5), y: H * (.22 + Math.floor(i / 2) * .5), s: W * .22, bob: Math.sin(t * 4 + i) * .01, ...p }));
});
// Character 2 in the jumping pose of the reference: --test=cast2
VIDEO.test('cast2', (t) => {
  const c = VIDEO.ctx, W = VIDEO.W, H = VIDEO.H;
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
  chibi(c, MIKU, { x: W * .28, y: H * .4, s: W * .24, eyes: ['round', 'happy'], mouth: 'grin', fang: 1, blush: .6, armL: 2.4, armR: 2.2, fists: true, jump: 1, tilt: -.12, hairSway: .4, tailWag: .6, emote: { kind: 'lines', x: -.9, y: -.7, s: .2 } });
  chibi(c, MIKU, { x: W * .72, y: H * .4, s: W * .24, eyes: 'round', mouth: 'smile', blush: .3, look: [-.4, .1], emote: { kind: 'q', x: .7, y: -.8, s: .18 } });
});
