// shared.js: palette and small drawing helpers shared by every chapter.
const PAL = { night: '#1d2340', sky: '#8ec3e6', sun: '#ffc857', coral: '#ef6f6c', cream: '#fff5e2' };
function disc(c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
