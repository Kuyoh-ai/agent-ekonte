// BuildStep.tsx: step 5. Claude's lead agent and chapter-builder subagents write the scene code; the user previews
// real frames, follows per-shot progress and asks for retakes.
import { useEffect, useRef, useState } from 'react';
import { api, fmtTime, type ProjectData, type Storyboard } from '../api.ts';
import { ClaudeSettings } from '../components/Extras.tsx';
import { ShotInspector } from '../components/ShotInspector.tsx';
import { Timeline } from '../components/Timeline.tsx';
import { Icon, StatusChip, useAction, useToast } from '../components/ui.tsx';
import { findShot, openCommentCount, shotsOf, STATUS_LABEL } from '../storyboard.ts';

interface Props { slug: string; data: ProjectData; version: number; sel: string | null; setSel: (id: string) => void; picked: Set<string>; setPicked: (s: Set<string>) => void; onNext: () => void }

export function BuildStep({ slug, data, sel, setSel, picked, setPicked, onNext }: Props) {
  const toast = useToast();
  const [busy, act] = useAction();
  const [t, setT] = useState(0);
  const [frame, setFrame] = useState<{ ms: number; error: string | null; shot?: string } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const p = data.project, sb = data.storyboard, locked = !!data.running;
  const flat = shotsOf(sb);
  const counts = flat.reduce<Record<string, number>>((m, x) => { m[x.shot.status] = (m[x.shot.status] || 0) + 1; return m; }, {});
  const built = counts.built || 0;
  const [reloadKey, setReloadKey] = useState(0);

  // Reload the preview when Claude finishes a run or the chapter list changes.
  useEffect(() => { if (!data.running) setReloadKey(k => k + 1); }, [data.running?.id, data.files.chapters.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const m = e.data as { type: string; ms?: number; error?: string | null; info?: { shotId: string } | null; message?: string };
      if (m.type === 'studio:ready') { setPageError(null); frameRef.current?.contentWindow?.postMessage({ type: 'studio:seek', t }, '*'); }
      if (m.type === 'studio:rendered') setFrame({ ms: m.ms || 0, error: m.error || null, shot: m.info?.shotId });
      if (m.type === 'studio:error') setPageError(m.message || 'error');
    };
    window.addEventListener('message', onMsg); return () => window.removeEventListener('message', onMsg);
  }, [t]);
  const seek = (v: number) => { const x = Math.max(0, Math.min(p.format.duration - 1 / p.format.fps, v)); setT(x); frameRef.current?.contentWindow?.postMessage({ type: 'studio:seek', t: x }, '*'); };
  const stepFrames = (n: number) => seek(Math.round((t + n / p.format.fps) * p.format.fps) / p.format.fps);
  const save = async (next: Storyboard, msg?: string) => { await api.saveStoryboard(slug, next); if (msg) toast(msg); };
  const sh = findShot(sb, sel);
  const pickedWithNotes = [...picked].filter(id => { const s = findShot(sb, id)?.shot; return s && (openCommentCount(s) > 0); });

  return (
    <div className="page wide">
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Step 5 · Claude</span>
          <h1>本制作</h1>
          <p>Claude（リーダー）が土台を作り、章ごとのサブエージェントが並行してコードで描きます。各自がレンダリングして見た目を確認しながら進めます。</p>
        </div>
        <span className="spacer" />
        <div className="kpis">
          <div className="kpi"><b>{built}/{flat.length}</b><span>完成</span></div>
          <div className="kpi"><b>{counts.building || 0}</b><span>制作中</span></div>
          <div className="kpi"><b>{(counts.blocked || 0) + (counts.retake || 0)}</b><span>要対応・リテイク</span></div>
        </div>
      </div>
      <div className="progress ok" aria-label="完成したショットの割合"><i style={{ width: `${flat.length ? built / flat.length * 100 : 0}%` }} /></div>

      <div className="row wrap">
        <button className="btn primary" disabled={locked || busy || !flat.length} onClick={() => act(() => api.runAgent(slug, 'build'), 'Claude に依頼しました')}>
          <Icon name="spark" />{built ? '残りを制作' : '制作を開始'}</button>
        <button className="btn" disabled={locked || busy || !picked.size} title="選んだショットにコメントを付けてから依頼してください"
          onClick={() => act(async () => { await api.setStatus(slug, [...picked], 'retake'); await api.runAgent(slug, 'retake', '', [...picked]); setPicked(new Set()); }, 'リテイクを依頼しました')}>
          <Icon name="refresh" />選んだ {picked.size} ショットをリテイク{picked.size && pickedWithNotes.length < picked.size ? '（コメントなしあり）' : ''}</button>
        {picked.size > 0 && <button className="btn ghost" onClick={() => setPicked(new Set())}>選択を解除</button>}
        <span className="spacer" />
        <button className="btn primary lg" disabled={locked || built === 0} onClick={onNext}>書き出しへ<Icon name="next" /></button>
      </div>
      {!built && !locked && <ClaudeSettings slug={slug} data={data} which="production" />}

      <div className="review">
        <div className="stack" style={{ gap: 8 }}>
          <div className="screen" style={{ ['--ar' as string]: `${p.format.width} / ${p.format.height}`, ['--arn' as string]: String(p.format.width / p.format.height) }}>
            <iframe ref={frameRef} key={reloadKey} src={`/p/${slug}/studio.html?embed&v=${reloadKey}`} title="プレビュー" onLoad={() => setFrame(null)} />
          </div>
          <div className="row wrap small">
            <button className="btn sm" onClick={() => stepFrames(-1)} aria-label="1フレーム戻る"><Icon name="prev" /></button>
            <input type="range" min={0} max={p.format.duration} step={1 / p.format.fps} value={t} onChange={e => seek(+e.target.value)} style={{ flex: 1, accentColor: 'var(--accent)' }} aria-label="時刻" />
            <button className="btn sm" onClick={() => stepFrames(1)} aria-label="1フレーム進む"><Icon name="nextf" /></button>
            <span className="mono tnum" style={{ minWidth: 88 }}>{fmtTime(t)}</span>
            <span className="muted tnum">{frame ? `${frame.ms} ms/フレーム${frame.shot ? ' · ' + frame.shot : ''}` : '描画中…'}</span>
            <button className="btn sm ghost" onClick={() => setReloadKey(k => k + 1)} title="コードの変更を読み込み直す"><Icon name="refresh" />再読み込み</button>
          </div>
          {(pageError || frame?.error) && <pre className="notice err" style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>{frame?.error || pageError}</pre>}
          <p className="small muted">プレビューは実際の書き出しと同じコードで 1 フレームずつ描いています（リアルタイム再生ではありません）。</p>
        </div>
        <div className="inspector">
          {sh ? <ShotInspector slug={slug} data={data} shotId={sel} save={save} locked={locked} fields="compact" /> : <div className="card flat"><p className="muted">ショットを選ぶと詳細とコメントを表示します。</p></div>}
        </div>
      </div>

      <Timeline slug={slug} data={data} t={t} playing={false} onSeek={seek} onToggle={() => {}} selected={sel}
        onSelect={id => { setSel(id); const s = flat.find(x => x.shot.id === id); if (s) seek(s.shot.start + .01); }} />

      <section className="card flat" style={{ padding: 10 }}>
        <div className="row" style={{ padding: '2px 8px 8px' }}><b>ショット一覧</b><span className="small muted">チェックしたショットをリテイクに回せます</span></div>
        <div className="shot-list">
          {flat.map(({ shot: s, chapter: c }) => (
            <div key={s.id} className={`shot-line ${sel === s.id ? 'sel' : ''}`} style={{ gridTemplateColumns: '24px 54px 92px minmax(0,1fr) auto' }}>
              <input type="checkbox" checked={picked.has(s.id)} onChange={() => { const n = new Set(picked); n.has(s.id) ? n.delete(s.id) : n.add(s.id); setPicked(n); }} aria-label={`${s.id} を選択`} />
              <span className="mono small muted">{s.id}</span>
              <button className="mono small tnum btn ghost sm" style={{ padding: '0 4px' }} onClick={() => { setSel(s.id); seek(s.start + .01); }}>{s.start.toFixed(1)}s</button>
              <span className="small" onClick={() => { setSel(s.id); seek(s.start + .01); }} style={{ cursor: 'pointer' }}><b>{s.title}</b> <span className="muted">· {c.id}</span>{s.statusNote && <span className="muted"> — {s.statusNote}</span>}</span>
              <span className="row" style={{ gap: 4 }}>{openCommentCount(s) > 0 && <span className="chip st-retake">{openCommentCount(s)}</span>}<StatusChip status={s.status} /></span>
            </div>
          ))}
        </div>
      </section>
      <p className="small muted">状態: {Object.entries(counts).map(([k, v]) => `${STATUS_LABEL[k as keyof typeof STATUS_LABEL]} ${v}`).join(' · ')}</p>
    </div>
  );
}
