// ui.tsx: small shared pieces: toast, status chip, icons, a tiny markdown renderer.
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { Shot } from '../api.ts';
import { STATUS_LABEL } from '../storyboard.ts';

type ToastFn = (msg: string, kind?: 'ok' | 'err') => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; kind: 'ok' | 'err'; id: number } | null>(null);
  const show = useCallback<ToastFn>((msg, kind = 'ok') => {
    const id = Date.now(); setT({ msg, kind, id });
    setTimeout(() => setT(x => (x?.id === id ? null : x)), kind === 'err' ? 6000 : 2600);
  }, []);
  return <ToastCtx.Provider value={show}>{children}{t && <div className={`toast ${t.kind}`} role="status">{t.msg}</div>}</ToastCtx.Provider>;
}

// Wrap an async action: shows errors as a toast and returns a busy flag.
export function useAction() {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast(okMsg); return true; }
    catch (e) { toast((e as Error).message, 'err'); return false; }
    finally { setBusy(false); }
  }, [toast]);
  return [busy, run] as const;
}

export const StatusChip = ({ status }: { status: Shot['status'] }) => <span className={`chip st-${status}`}>{STATUS_LABEL[status]}</span>;

const paths: Record<string, string> = {
  play: 'M5 3l9 5-9 5z', pause: 'M4 3h3v10H4zM9 3h3v10H9z', stop: 'M4 4h8v8H4z', send: 'M2 8l12-5-4 12-2-5z',
  history: 'M8 2a6 6 0 1 1-6 6M2 3v3h3M8 5v3l2 2', spark: 'M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z',
  check: 'M3 8.5l3 3 7-7', back: 'M10 3L5 8l5 5', next: 'M6 3l5 5-5 5', plus: 'M8 3v10M3 8h10', trash: 'M3 4h10M6 4V2.5h4V4M4.5 4l.7 9h5.6l.7-9',
  split: 'M8 2v12M3 5l-2 3 2 3M13 5l2 3-2 3', chat: 'M2 3h12v8H7l-3 3v-3H2z', film: 'M2 3h12v10H2zM5 3v10M11 3v10M2 6h3M2 10h3M11 6h3M11 10h3',
  music: 'M6 12V3l7-1.5v9M6 12a2 2 0 1 1-2-2M13 10.5a2 2 0 1 1-2-2', mic: 'M8 1.5a2 2 0 0 1 2 2V8a2 2 0 0 1-4 0V3.5a2 2 0 0 1 2-2zM4 7.5a4 4 0 0 0 8 0M8 11.5V14',
  download: 'M8 2v8M4.5 7L8 10.5 11.5 7M3 13h10', refresh: 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5', panel: 'M2 3h12v10H2zM10 3v10',
  prev: 'M4 3v10M13 3L6 8l7 5z', nextf: 'M12 3v10M3 3l7 5-7 5z',
};
export function Icon({ name, className = 'icon' }: { name: keyof typeof paths | string; className?: string }) {
  const fill = ['play', 'pause', 'stop', 'prev', 'nextf', 'send'].includes(name);
  return <svg className={className} viewBox="0 0 16 16" aria-hidden="true" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

// Minimal markdown: headings, lists, bold, inline code, hex swatches. Enough for style.md.
export function Markdown({ text }: { text: string }) {
  const inline = (s: string, k: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*|`[^`]+`|#[0-9a-fA-F]{6}\b)/).map((part, i) => {
    if (/^\*\*.+\*\*$/.test(part)) return <b key={k + i}>{part.slice(2, -2)}</b>;
    if (/^`.+`$/.test(part)) return <code key={k + i}>{part.slice(1, -1)}</code>;
    if (/^#[0-9a-fA-F]{6}$/.test(part)) return <span key={k + i} className="mono"><i className="swatch-inline" style={{ background: part }} />{part}</span>;
    return part;
  });
  const out: ReactNode[] = []; let list: ReactNode[] = [];
  const flush = () => { if (list.length) { out.push(<ul key={'u' + out.length}>{list}</ul>); list = []; } };
  text.split(/\r?\n/).forEach((line, i) => {
    const h = /^(#{1,3})\s+(.*)$/.exec(line), li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (h) { flush(); const Tag = (`h${h[1].length}`) as 'h1'; out.push(<Tag key={i}>{inline(h[2], 'h' + i)}</Tag>); }
    else if (li) list.push(<li key={i}>{inline(li[1], 'l' + i)}</li>);
    else if (line.trim()) { flush(); out.push(<p key={i}>{inline(line, 'p' + i)}</p>); }
    else flush();
  });
  flush();
  return <div className="md">{out}</div>;
}
