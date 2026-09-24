// usePlayback.ts: a playhead clock for storyboards and animatics. Music (if any) is the master clock; otherwise
// requestAnimationFrame drives time. Narration clips play at their shot times.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Clip { at: number; url: string }

export function usePlayback(duration: number, musicUrl: string | null, clips: Clip[] = []) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const raf = useRef(0), base = useRef({ wall: 0, t: 0 });
  const tRef = useRef(0); tRef.current = t;
  const clipEls = useRef<Map<string, HTMLAudioElement>>(new Map());
  const played = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!musicUrl) { audio.current = null; return; }
    const a = new Audio(musicUrl); a.preload = 'auto'; audio.current = a;
    return () => { a.pause(); audio.current = null; };
  }, [musicUrl]);

  const stopClips = () => { for (const el of clipEls.current.values()) el.pause(); };
  const tick = useCallback(() => {
    const now = audio.current && !audio.current.paused ? audio.current.currentTime : base.current.t + (performance.now() - base.current.wall) / 1000;
    if (now >= duration) { setT(duration); setPlaying(false); audio.current?.pause(); stopClips(); return; }
    setT(now);
    for (const c of clips) {
      const key = `${c.url}@${c.at}`;
      if (now >= c.at && now < c.at + .25 && !played.current.has(key)) {
        played.current.add(key);
        let el = clipEls.current.get(c.url); if (!el) { el = new Audio(c.url); clipEls.current.set(c.url, el); }
        el.currentTime = Math.max(0, now - c.at); el.play().catch(() => {});
      }
    }
    raf.current = requestAnimationFrame(tick);
  }, [duration, clips]);

  const play = useCallback(() => {
    let from = tRef.current; if (from >= duration - .05) from = 0;
    played.current = new Set(clips.filter(c => c.at < from - .01).map(c => `${c.url}@${c.at}`));
    base.current = { wall: performance.now(), t: from };
    if (audio.current) { audio.current.currentTime = from; audio.current.play().catch(() => {}); }
    setT(from); setPlaying(true);
    cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(tick);
  }, [duration, tick, clips]);

  const pause = useCallback(() => { cancelAnimationFrame(raf.current); audio.current?.pause(); stopClips(); setPlaying(false); }, []);
  const seek = useCallback((to: number) => {
    const v = Math.max(0, Math.min(duration, to)); setT(v);
    base.current = { wall: performance.now(), t: v };
    if (audio.current) audio.current.currentTime = v;
    played.current = new Set(clips.filter(c => c.at < v - .01).map(c => `${c.url}@${c.at}`)); stopClips();
  }, [duration, clips]);

  useEffect(() => () => { cancelAnimationFrame(raf.current); stopClips(); }, []);
  return { t, playing, play, pause, seek, toggle: () => (playing ? pause() : play()) };
}
