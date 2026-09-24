// ReviewStep.tsx: step 3. Review the timeline with Claude: comment on shots, edit directly, adjust cuts, refine style.
import { useEffect, useMemo, useState } from 'react';
import { api, fileUrl, type ProjectData, type Storyboard } from '../api.ts';
import { ShotInspector } from '../components/ShotInspector.tsx';
import { Timeline } from '../components/Timeline.tsx';
import { usePlayback } from '../components/usePlayback.ts';
import { Icon, Markdown, StatusChip, useAction, useToast } from '../components/ui.tsx';
import { openCommentCount, shotAt, shotsOf } from '../storyboard.ts';
import type { TtsState } from '../api.ts';

interface Props { slug: string; data: ProjectData; sel: string | null; setSel: (id: string) => void; onNext: () => void; tts: TtsState | null }

export function ReviewStep({ slug, data, sel, setSel, onNext, tts }: Props) {
  const toast = useToast();
  const [busy, act] = useAction();
  const [tab, setTab] = useState<'timeline' | 'style'>('timeline');
  const p = data.project, sb = data.storyboard, locked = !!data.running;
  const music = p.audio.music?.file ? fileUrl(slug, p.audio.music.file) : null;
  const clips = useMemo(() => shotsOf(sb).filter(x => x.shot.narrationAudio).map(x => ({ at: x.shot.start + p.audio.narration.gap / 2, url: fileUrl(slug, x.shot.narrationAudio!.file) })), [sb, slug, p.audio.narration.gap]);
  const pb = usePlayback(p.format.duration, music, clips);
  const open = shotsOf(sb).reduce((n, x) => n + openCommentCount(x.shot), 0);

  useEffect(() => { if (!pb.playing) return; const hit = shotAt(sb, pb.t); if (hit && hit.shot.id !== sel) setSel(hit.shot.id); }, [pb.t]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (next: Storyboard, msg?: string) => {
    const r = await api.saveStoryboard(slug, next);
    if (r.problems.length) toast('保存しましたが、確認が必要な点があります: ' + r.problems[0], 'err'); else if (msg) toast(msg);
  };
  if (!sb.chapters.length) return <div className="page"><div className="empty">まだ構成案がありません。前の工程で Claude に作ってもらってください。</div></div>;
  const narrated = shotsOf(sb).filter(x => x.shot.narration.trim()), synthesized = narrated.filter(x => x.shot.narrationAudio);

  return (
    <div className="page wide">
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Step 3 · あなた ⇄ Claude</span>
          <h1>構成レビュー</h1>
          <p>ショットを選んでコメントを付け、右のパネルから Claude に送ると反映されます。文言やカット位置は直接編集もできます。</p>
        </div>
        <span className="spacer" />
        {open > 0 && <span className="chip st-retake">未対応のコメント {open}</span>}
        <button className="btn primary lg" disabled={locked || busy} onClick={() => act(async () => { await api.patch(slug, { approvals: { ...p.approvals, storyboard: true } }); onNext(); })}>
          <Icon name="check" />構成を確定してラフへ</button>
      </div>

      <Timeline slug={slug} data={data} t={pb.t} playing={pb.playing} onSeek={pb.seek} onToggle={pb.toggle} selected={sel} onSelect={id => { setSel(id); const s = shotsOf(sb).find(x => x.shot.id === id); if (s && !pb.playing) pb.seek(s.shot.start); }}
        editable={!locked} onChange={next => act(() => save(next))} />

      {p.audio.narration.enabled && (
        <section className="card flat row wrap">
          <Icon name="mic" />
          <b>ナレーション音声</b>
          <span className="small muted">{synthesized.length}/{narrated.length} ショット合成済み</span>
          {tts?.phase === 'progress' && <span className="working small"><i />合成中 {tts.done}/{tts.total}</span>}
          {tts?.phase === 'error' && <span className="small" style={{ color: 'var(--err)' }}>{tts.message}</span>}
          <span className="spacer" />
          <button className="btn sm" disabled={busy || locked || !narrated.length || tts?.phase === 'progress'} onClick={() => act(() => api.synthesize(slug, true), '合成を始めました')}>音声を合成して長さを合わせる</button>
        </section>
      )}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'timeline'} onClick={() => setTab('timeline')}>ショット</button>
        <button role="tab" aria-selected={tab === 'style'} onClick={() => setTab('style')}>スタイルガイド</button>
      </div>

      {tab === 'timeline' ? (
        <div className="review">
          <section className="card flat" style={{ padding: 10 }}>
            {sb.chapters.map(c => (
              <div key={c.id} style={{ marginBottom: 10 }}>
                <div className="row" style={{ padding: '4px 8px' }}><i className="swatch-inline" style={{ background: c.palette[1] || c.palette[0] }} /><b>{c.title}</b><span className="small muted">{c.summary}</span></div>
                <div className="shot-list">
                  {c.shots.map(s => (
                    <button key={s.id} className={`shot-line ${sel === s.id ? 'sel' : ''}`} onClick={() => { setSel(s.id); if (!pb.playing) pb.seek(s.start); }}>
                      <span className="mono small muted">{s.id}</span>
                      <span className="mono small tnum">{s.start.toFixed(1)}–{s.end.toFixed(1)}s</span>
                      <span className="small"><b>{s.title}</b> — {s.action}</span>
                      <span className="row" style={{ gap: 4 }}>{openCommentCount(s) > 0 && <span className="chip st-retake">{openCommentCount(s)}</span>}<StatusChip status={s.status} /></span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
          <div className="inspector"><ShotInspector slug={slug} data={data} shotId={sel} save={save} locked={locked} /></div>
        </div>
      ) : <StyleEditor slug={slug} data={data} locked={locked} />}
    </div>
  );
}

function StyleEditor({ slug, data, locked }: { slug: string; data: ProjectData; locked: boolean }) {
  const [text, setText] = useState(data.style);
  const [editing, setEditing] = useState(false);
  const [busy, act] = useAction();
  useEffect(() => { if (!editing) setText(data.style); }, [data.style, editing]);
  return (
    <section className="card stack">
      <div className="row"><span className="small muted">style.md · 制作するエージェント全員がこれに従います</span><span className="spacer" />
        {editing ? <>
          <button className="btn sm ghost" onClick={() => { setEditing(false); setText(data.style); }}>やめる</button>
          <button className="btn sm primary" disabled={busy} onClick={() => act(async () => { await api.saveStyle(slug, text); setEditing(false); }, 'スタイルガイドを保存しました')}>保存</button>
        </> : <button className="btn sm" disabled={locked} onClick={() => setEditing(true)}>編集</button>}
      </div>
      {editing ? <textarea className="input mono" rows={24} value={text} onChange={e => setText(e.target.value)} /> : text.trim() ? <Markdown text={text} /> : <p className="muted">まだありません。</p>}
    </section>
  );
}
