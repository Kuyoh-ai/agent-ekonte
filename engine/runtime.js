// runtime.js: the frame runtime shared by every project (generalised from examples/pdoom/src/core.js + timeline.js).
//
// Contract: a video is a set of chapters, each a list of shots. A shot is a function of time that paints the whole frame.
// Frames render in parallel and out of order, so a shot must be a pure function of t: no state carried between frames
// and no Math.random() (use hash(i), rand() or jit(a), which are reseeded per frame).
//
//   VIDEO.chapter('intro', 0, 8.5, [[0, titleCard, 's01'], [3.2, reveal, 's02']]);
//   function titleCard(t, lt, dur, info) { const c = VIDEO.ctx; ... }   // lt = time since shot start, dur = shot length
//
// By default shots draw with Canvas2D on VIDEO.ctx. A project that paints with p5 / three / anything else draws into its
// own canvas and calls VIDEO.useSource(canvas) once; the runtime copies that canvas into the output after each shot.
// Overlays (VIDEO.overlay) and captions are drawn on top, in that order.
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, x) => a + (b - a) * x;
  const frac = x => x - Math.floor(x);
  const ease = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const easeIn = x => Math.pow(clamp(x), 3);
  const easeOut = x => 1 - Math.pow(1 - clamp(x), 3);
  const easeInOut = x => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const backOut = x => { x = clamp(x); const s = 1.9; return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2); };
  const elasticOut = x => { x = clamp(x); return x === 0 || x === 1 ? x : Math.pow(2, -10 * x) * Math.sin((x * 10 - .75) * (TAU / 3)) + 1; };
  const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const wob = (t, f = 1, ph = 0) => Math.sin((t * f + ph) * TAU);
  // keyframes: kf(t, [[t0, v0], [t1, v1], ...], easeFn). Values may be numbers or arrays of numbers.
  function kf(t, keys, e = ease) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
      if (t <= t1) { const k = e((t - t0) / (t1 - t0)); return Array.isArray(v0) ? v0.map((v, j) => lerp(v, v1[j], k)) : lerp(v0, v1, k); }
    }
    return keys[keys.length - 1][1];
  }
  function mixCol(a, b, k) {
    const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), A = p(a), B = p(b);
    return '#' + A.map((v, i) => Math.round(lerp(v, B[i], clamp(k))).toString(16).padStart(2, '0')).join('');
  }
  // Seeded PRNG (mulberry32). rng(seed) returns a function; rand()/jit() use a per-frame seed.
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  let frameRand = rng(1);
  const rand = () => frameRand();
  const jit = a => (frameRand() * 2 - 1) * a;

  const V = {
    W: 1920, H: 1080, fps: 24, duration: 10, bpm: 0, beatOffset: 0, boil: 12,
    project: null, captions: [], chapters: [], overlays: [], source: null, T: 0,
    canvas: null, ctx: null, ready: false, lastError: null, _waits: [], _setups: [], _boot: null, assets: [], images: {},
  };

  // ---------- beat helpers (active when project.json has audio.music.bpm) ----------
  const beatLen = () => V.bpm > 0 ? 60 / V.bpm : 0.5;
  const bpOf = t => (t - V.beatOffset) / beatLen();
  const beatN = t => Math.floor(bpOf(t));
  const beatTime = n => V.beatOffset + n * beatLen();
  const pulse = (t, k = 6) => Math.exp(-frac(bpOf(t)) * k);
  const pulse2 = (t, k = 6) => Math.exp(-frac(bpOf(t) * 2) * k);

  // ---------- registry ----------
  V.chapter = (id, start, end, shots) => {
    if (!Array.isArray(shots) || !shots.length) throw new Error(`chapter ${id}: shots must be a non-empty [[t0, fn, shotId?], ...] list`);
    const sorted = shots.slice().sort((a, b) => a[0] - b[0]);
    V.chapters = V.chapters.filter(c => c.id !== id);
    V.chapters.push({ id, start, end, shots: sorted });
    V.chapters.sort((a, b) => a.start - b.start);
  };
  V.overlay = fn => { V.overlays.push(fn); };
  // Look-dev tests: VIDEO.test('cast', fn) registers a frame painter outside the timeline (model sheets, style frames,
  // texture tests). Open studio.html?test=cast or render with --test=cast; t is then just the test's own time.
  V.tests = {};
  V.test = (name, fn) => { V.tests[name] = fn; };
  V.activeTest = new URLSearchParams(location.search).get('test');
  V.useSource = (canvas, opts = {}) => { V.source = { canvas, ...opts }; };
  V.whenReady = p => { V._waits.push(Promise.resolve(p)); };
  // setup(fn): runs once after project.json is loaded (VIDEO.W/H/ctx are valid) and before the first frame. May be async.
  V.setup = fn => { V._setups.push(fn); };

  V.locate = t => {
    const ch = V.chapters.find(c => t >= c.start && t < c.end) || (t >= V.duration - 1e-6 ? V.chapters[V.chapters.length - 1] : null);
    if (!ch) return null;
    let i = 0; while (i + 1 < ch.shots.length && t >= ch.shots[i + 1][0]) i++;
    const t0 = ch.shots[i][0], end = i + 1 < ch.shots.length ? ch.shots[i + 1][0] : ch.end;
    return { chapter: ch.id, index: i, shotId: ch.shots[i][2] || `${ch.id}#${i + 1}`, fn: ch.shots[i][1], t0, end };
  };

  // VIDEO.image('img1') → decoded HTMLImageElement of an uploaded asset.
  V.image = id => { const img = V.images[String(id).replace(/^@/, '')]; if (!img) throw new Error(`unknown image asset "${id}" (have: ${Object.keys(V.images).join(', ') || 'none'})`); return img; };
  V.captionAt = t => V.captions.find(c => t >= c.start && t < c.end) || null;

  // ---------- default drawing ----------
  function placeholder(t) {
    const c = V.ctx; c.fillStyle = '#20232b'; c.fillRect(0, 0, V.W, V.H);
    c.fillStyle = '#9aa3b5'; c.font = `600 ${Math.round(V.H / 22)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('(no shot at ' + t.toFixed(2) + ' s)', V.W / 2, V.H / 2);
  }
  function drawCaption(t) {
    const style = V.project?.captions || 'none'; if (style === 'none') return;
    const cap = V.captionAt(t); if (!cap) return;
    const c = V.ctx, size = Math.round(V.H * .044), y = V.H * .9, pad = size * .6;
    const k = easeOut((t - cap.start) / .15) * (1 - ease((t - (cap.end - .12)) / .12)); if (k < .02) return;
    c.save(); c.globalAlpha = k; c.font = `700 ${size}px "Noto Sans JP","Hiragino Sans","Yu Gothic",system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const w = c.measureText(cap.text).width;
    c.fillStyle = 'rgba(15,16,22,.72)'; roundRect(c, V.W / 2 - w / 2 - pad, y - size * .85, w + pad * 2, size * 1.7, size * .4); c.fill();
    if (style === 'karaoke') {
      const sung = clamp((t - cap.start) / Math.max(.3, Math.min(cap.end - cap.start - .1, .45 + cap.text.length * .075)));
      c.fillStyle = '#FFFFFF'; c.fillText(cap.text, V.W / 2, y);
      c.save(); c.beginPath(); c.rect(V.W / 2 - w / 2, y - size, w * sung, size * 2); c.clip(); c.fillStyle = '#FFC857'; c.fillText(cap.text, V.W / 2, y); c.restore();
    } else { c.fillStyle = '#FFFFFF'; c.fillText(cap.text, V.W / 2, y); }
    c.restore();
  }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // ---------- frame ----------
  async function paintFrame(t) {
    V.T = t; frameRand = rng(1000 + Math.floor(t * V.boil));
    const c = V.ctx; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, V.W, V.H); c.restore();
    const test = V.activeTest ? V.tests[V.activeTest] : null;
    if (V.activeTest && !test) throw new Error(`no VIDEO.test named "${V.activeTest}" (registered: ${Object.keys(V.tests).join(', ') || 'none'})`);
    const loc = test ? null : V.locate(t);
    const info = test ? { chapter: 'test', shotId: `test:${V.activeTest}`, t0: 0, end: Infinity, p: 0 }
      : loc ? { chapter: loc.chapter, shotId: loc.shotId, t0: loc.t0, end: loc.end, p: clamp((t - loc.t0) / (loc.end - loc.t0)) } : null;
    if (test) await test(t, t, Infinity, info);
    else if (loc) await loc.fn(t, t - loc.t0, loc.end - loc.t0, info); else placeholder(t);
    if (V.source) { if (V.source.beforeCopy) await V.source.beforeCopy(t); c.drawImage(V.source.canvas, 0, 0, V.W, V.H); }
    for (const fn of V.overlays) await fn(t, info);
    if (!test) drawCaption(t);
    return info;
  }
  window.renderAt = async (t, type = 'image/png', q = .92) => {
    await paintFrame(t);
    return V.canvas.toDataURL(type, q);
  };
  // Contact sheet of several times for quick visual checks: returns { url, ms[] }.
  window.renderSheet = async (times, cols = 3, w = 640) => {
    const h = Math.round(w * V.H / V.W), rows = Math.ceil(times.length / cols), sc = document.createElement('canvas');
    sc.width = cols * w; sc.height = rows * h; const c = sc.getContext('2d'), ms = [];
    for (let i = 0; i < times.length; i++) {
      const t0 = performance.now(); const info = await paintFrame(times[i]); ms.push(Math.round(performance.now() - t0));
      const x = (i % cols) * w, y = Math.floor(i / cols) * h;
      c.drawImage(V.canvas, x, y, w, h);
      const label = times[i].toFixed(2) + 's' + (info ? '  ' + info.shotId : '');
      c.font = '15px system-ui, sans-serif'; const lw = c.measureText(label).width + 12;
      c.fillStyle = 'rgba(0,0,0,.65)'; c.fillRect(x, y, lw, 24); c.fillStyle = '#fff'; c.fillText(label, x + 6, y + 17);
    }
    return { url: sc.toDataURL('image/jpeg', .88), ms };
  };
  window.frameInfo = t => { const l = V.locate(t); return l ? { chapter: l.chapter, shotId: l.shotId, t0: l.t0, end: l.end } : null; };
  window.timeline = () => V.chapters.map(c => ({ id: c.id, start: c.start, end: c.end, shots: c.shots.map(s => ({ t0: s[0], shotId: s[2] || null })) }));

  // ---------- boot ----------
  async function loadJSON(url, fallback) { try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : fallback; } catch { return fallback; } }
  V.boot = async () => {
    const p = await loadJSON('project.json', null);
    if (p) {
      V.project = p; V.W = p.format?.width || V.W; V.H = p.format?.height || V.H; V.fps = p.format?.fps || V.fps; V.duration = p.format?.duration || V.duration;
      V.bpm = p.audio?.music?.bpm || 0; V.beatOffset = p.audio?.music?.offset || 0;
    }
    V.captions = await loadJSON('captions.json', []);
    // Image assets (@img1 ...): decoded before the first frame so shots can draw them synchronously.
    V.assets = p?.assets || [];
    await Promise.all(V.assets.map(async a => {
      const img = new Image(); img.src = a.file;
      try { await img.decode(); V.images[a.id] = img; } catch { reportError(new Error(`image asset @${a.id} (${a.file}) could not be loaded`)); }
    }));
    if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
    let cv = document.getElementById('out');
    if (!cv) { cv = document.createElement('canvas'); cv.id = 'out'; document.body.prepend(cv); }
    cv.width = V.W; cv.height = V.H; V.canvas = cv; V.ctx = cv.getContext('2d', { willReadFrequently: false });
  };
  V.start = async () => {
    try { await V._boot; for (const fn of V._setups) await fn(); await Promise.all(V._waits); await document.fonts.ready; }
    catch (e) { reportError(e); }
    V.ready = true; window.ready = true;
    if (!location.search.includes('render')) devUI();
  };

  function reportError(e) {
    const msg = (e && (e.stack || e.message)) || String(e);
    V.lastError = msg; console.error(msg);
    try { parent !== window && parent.postMessage({ type: 'studio:error', message: msg }, '*'); } catch {}
  }
  window.addEventListener('error', e => reportError(e.error || e.message));
  window.addEventListener('unhandledrejection', e => reportError(e.reason));

  // ---------- dev UI (studio.html opened without ?render, or embedded in the GUI) ----------
  function devUI() {
    const embedded = parent !== window;
    const bar = document.createElement('div'); bar.className = 'studio-bar'; if (embedded) bar.hidden = true;
    bar.innerHTML = '<input type="range" min="0" step="0.0417"><span></span>';
    document.body.appendChild(bar);
    const s = bar.querySelector('input'), lab = bar.querySelector('span'); s.max = V.duration;
    let busy = false, want = null;
    const go = async () => {
      if (busy) return; busy = true;
      while (want != null) {
        const t = want; want = null; const t0 = performance.now(); let info = null, err = null;
        try { info = await paintFrame(t); } catch (e) { err = e; reportError(e); }
        const ms = Math.round(performance.now() - t0);
        lab.textContent = `${t.toFixed(2)}s · ${ms} ms/frame${info ? ' · ' + info.shotId : ''}`;
        if (embedded) parent.postMessage({ type: 'studio:rendered', t, ms, info, error: err ? String(err.message || err) : null }, '*');
      }
      busy = false;
    };
    s.addEventListener('input', () => { want = +s.value; go(); });
    window.addEventListener('message', e => { if (e.data?.type === 'studio:seek') { want = +e.data.t; s.value = want; go(); } });
    want = +(new URLSearchParams(location.search).get('t') || 0); s.value = want; go();
    if (embedded) parent.postMessage({ type: 'studio:ready', duration: V.duration, timeline: window.timeline() }, '*');
  }

  Object.assign(window, {
    VIDEO: V, TAU, clamp, lerp, frac, ease, easeIn, easeOut, easeInOut, backOut, elasticOut, hash, seg, wob, kf, mixCol, rng, rand, jit,
    bpOf, beatN, beatTime, pulse, pulse2,
  });
  V._boot = V.boot();
})();
