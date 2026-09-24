// Timeline.tsx: chapters, shots and audio cues on one time axis, with a playhead and draggable cuts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { fileUrl, fmtTime, type ProjectData, type Storyboard } from '../api.ts';
import { moveCut, openCommentCount, shotsOf, STATUS_LABEL } from '../storyboard.ts';
import { Icon } from './ui.tsx';

interface Props {
  slug: string; data: ProjectData;
  t: number; playing: boolean; onSeek: (t: number) => void; onToggle: () => void;
  selected: string | null; onSelect: (id: string) => void;
  editable?: boolean; onChange?: (sb: Storyboard) => void;
  thumbs?: boolean;
}

export function Timeline({ slug, data, t, playing, onSeek, onToggle, selected, onSelect, editable, onChange, thumbs }: Props) {
  const { project } = data;
  const [draft, setDraft] = useState<Storyboard | null>(null);
  const sb = draft || data.storyboard;
  const duration = Math.max(project.format.duration, sb.chapters.at(-1)?.end ?? 0, 1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth)); ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const pps = Math.max(8, (width - 2) / duration * zoom);
  const X = (s: number) => s * pps;
  const music = project.audio.music;

  // keep the playhead in view while playing
  useEffect(() => {
    const el = scrollRef.current; if (!el || !playing) return;
    const x = X(t); if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 40;
  });

  const ticks = useMemo(() => {
    const step = [0.5, 1, 2, 5, 10, 15, 30, 60].find(s => s * pps >= 56) || 60;
    const out: { x: number; label: string }[] = [];
    for (let s = 0; s <= duration + 1e-6; s += step) out.push({ x: s * pps, label: step < 1 ? s.toFixed(1) : fmtTime(s).replace(/\.\d+$/, '') });
    return out;
  }, [pps, duration]);
  const bars = useMemo(() => {
    if (!music?.bpm) return [];
    const bar = 240 / music.bpm; if (bar * pps < 6) return [];
    const out: number[] = []; for (let s = music.offset; s <= duration; s += bar) out.push(s);
    return out;
  }, [music?.bpm, music?.offset, pps, duration]);

  const timeFromEvent = (e: { clientX: number }) => {
    const el = scrollRef.current!; const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (e.clientX - r.left + el.scrollLeft) / pps));
  };
  const scrub = (e: RPointerEvent<HTMLDivElement>) => {
    onSeek(timeFromEvent(e));
    const move = (ev: PointerEvent) => onSeek(timeFromEvent(ev));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const dragCut = (shotId: string) => (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation(); e.preventDefault();
    let latest: Storyboard | null = null;
    const move = (ev: PointerEvent) => {
      let tt = timeFromEvent(ev);
      if (music?.bpm && !ev.altKey) { const beat = 60 / music.bpm; tt = music.offset + Math.round((tt - music.offset) / beat) * beat; } // snap to beats (Alt = free)
      const next = moveCut(data.storyboard, shotId, tt); if (next) { latest = next; setDraft(next); }
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (latest) onChange?.(latest); setTimeout(() => setDraft(null), 400);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const flat = shotsOf(sb);
  const audioRow = music?.lyrics?.length ? music.lyrics.map(l => ({ start: l.start, end: l.end, text: l.text, narr: false }))
    : project.audio.narration.enabled ? flat.filter(x => x.shot.narration).map(x => ({ start: x.shot.start, end: x.shot.narrationAudio ? x.shot.start + x.shot.narrationAudio.duration + project.audio.narration.gap : x.shot.end, text: x.shot.narration, narr: true }))
    : [];

  return (
    <div className="tl">
      <div className="tl-bar">
        <button className="btn sm" onClick={onToggle} aria-label={playing ? '一時停止' : '再生'}><Icon name={playing ? 'pause' : 'play'} /></button>
        <span className="tl-time">{fmtTime(t)}</span>
        <span style={{ color: 'var(--timeline-muted)' }} className="small tnum">/ {fmtTime(duration)}{music?.bpm ? ` · ${music.bpm} BPM` : ''}</span>
        <span className="spacer" />
        {editable && <span className="small" style={{ color: 'var(--timeline-muted)' }}>カットの境目をドラッグで調整{music?.bpm ? '（拍にスナップ・Altで自由）' : ''}</span>}
        <button className="btn sm" onClick={() => setZoom(z => Math.max(1, z / 1.5))} disabled={zoom <= 1} aria-label="縮小">−</button>
        <button className="btn sm" onClick={() => setZoom(z => Math.min(20, z * 1.5))} aria-label="拡大">＋</button>
      </div>
      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-inner" style={{ width: X(duration) + 2 }}>
          <div className="tl-ruler" onPointerDown={scrub}>
            {bars.map((b, i) => <i key={'b' + i} className="bar" style={{ left: X(b) }} />)}
            {ticks.map(k => <span key={k.x} style={{ left: k.x }}>{k.label}</span>)}
            {ticks.map(k => <i key={'t' + k.x} style={{ left: k.x }} />)}
          </div>
          <div className="tl-row" style={{ height: 30 }}>
            {sb.chapters.map(c => (
              <div key={c.id} className="tl-ch" style={{ left: X(c.start) + 1, width: X(c.end - c.start) - 2, background: c.palette[1] || c.palette[0] || '#bdb6aa' }} title={`${c.title} (${c.id})`}>
                {c.title || c.id}
              </div>
            ))}
          </div>
          <div className="tl-row" style={{ height: thumbs ? 76 : 58 }}>
            {flat.map(({ shot: s }) => {
              const w = X(s.end - s.start) - 2, n = openCommentCount(s), thumb = thumbs && data.files.drafts[`${s.id}.svg`];
              return (
                <button key={s.id} className={`tl-shot st-${s.status} ${selected === s.id ? 'sel' : ''}`} style={{ left: X(s.start) + 1, width: Math.max(4, w) }}
                  onClick={() => onSelect(s.id)} title={`${s.id} ${s.title} · ${STATUS_LABEL[s.status]}`}>
                  {thumb ? <span className="thumb" style={{ backgroundImage: `url(${fileUrl(slug, `drafts/${s.id}.svg`, thumb)})` }} /> : null}
                  {w > 40 && <b>{s.title || s.id}</b>}
                  {w > 60 && <small>{s.id} · {(s.end - s.start).toFixed(1)}s</small>}
                  {n > 0 && <span className="cm">{n}</span>}
                  <span className="stripe" />
                </button>
              );
            })}
            {editable && flat.slice(0, -1).map(({ shot: s }) => <div key={'h' + s.id} className="tl-handle" style={{ left: X(s.end) }} onPointerDown={dragCut(s.id)} title="ドラッグしてカット位置を変更" />)}
          </div>
          {audioRow.length > 0 && (
            <div className="tl-row" style={{ height: 26 }}>
              {audioRow.map((a, i) => <div key={i} className={`tl-audio ${a.narr ? 'narr' : ''}`} style={{ left: X(a.start), width: Math.max(3, X(a.end - a.start) - 2) }} title={a.text}>{a.text}</div>)}
            </div>
          )}
          <div className="tl-head" style={{ left: X(t) }} />
        </div>
      </div>
    </div>
  );
}
