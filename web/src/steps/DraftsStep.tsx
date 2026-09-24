// DraftsStep.tsx: step 4. Rough boards (one SVG key frame per shot), an animatic to check flow, and per-shot approval.
import { useEffect, useMemo } from 'react';
import { api, fileUrl, type ProjectData, type Storyboard, type TtsState } from '../api.ts';
import { ClaudeSettings } from '../components/Extras.tsx';
import { ShotInspector } from '../components/ShotInspector.tsx';
import { Timeline } from '../components/Timeline.tsx';
import { usePlayback } from '../components/usePlayback.ts';
import { Icon, StatusChip, useAction, useToast } from '../components/ui.tsx';
import { openCommentCount, shotAt, shotsOf } from '../storyboard.ts';

interface Props { slug: string; data: ProjectData; sel: string | null; setSel: (id: string) => void; picked: Set<string>; setPicked: (s: Set<string>) => void; onNext: () => void; tts: TtsState | null }

export function DraftsStep({ slug, data, sel, setSel, picked, setPicked, onNext }: Props) {
  const toast = useToast();
  const [busy, act] = useAction();
  const p = data.project, sb = data.storyboard, locked = !!data.running;
  const flat = shotsOf(sb);
  const music = p.audio.music?.file ? fileUrl(slug, p.audio.music.file) : null;
  const clips = useMemo(() => flat.filter(x => x.shot.narrationAudio).map(x => ({ at: x.shot.start + p.audio.narration.gap / 2, url: fileUrl(slug, x.shot.narrationAudio!.file) })), [flat, slug, p.audio.narration.gap]);
  const pb = usePlayback(p.format.duration, music, clips);
  const cur = shotAt(sb, pb.t);
  useEffect(() => { if (pb.playing && cur && cur.shot.id !== sel) setSel(cur.shot.id); }, [pb.t]); // eslint-disable-line react-hooks/exhaustive-deps
  const drafted = flat.filter(x => data.files.drafts[`${x.shot.id}.svg`]);
  const approved = flat.filter(x => ['approved', 'building', 'built'].includes(x.shot.status));
  const caption = (() => { const t = pb.t; const l = p.audio.music?.lyrics?.find(x => t >= x.start && t < x.end); return l?.text || (cur && cur.shot.narration && t < cur.shot.end ? cur.shot.narration : ''); })();
  const save = async (next: Storyboard, msg?: string) => { await api.saveStoryboard(slug, next); if (msg) toast(msg); };
  const togglePick = (id: string) => { const n = new Set(picked); n.has(id) ? n.delete(id) : n.add(id); setPicked(n); };
  const ar = `${p.format.width} / ${p.format.height}`;

  if (!sb.chapters.length) return <div className="page"><div className="empty">構成案がまだありません。</div></div>;
  const shown = cur && data.files.drafts[`${cur.shot.id}.svg`];
  const endFrame = cur && data.files.drafts[`${cur.shot.id}_b.svg`] && pb.t > (cur.shot.start + cur.shot.end) / 2;

  return (
    <div className="page wide">
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Step 4 · Claude → あなた</span>
          <h1>ラフ絵コンテ</h1>
          <p>本制作の前に、各ショットの構図をラフで確認します。再生すると音と合わせた仮の流れ（アニマティック）を見られます。気になるショットはコメントして描き直しを頼めます。</p>
        </div>
        <span className="spacer" />
        <span className="small muted tnum">ラフ {drafted.length}/{flat.length} · 承認 {approved.length}/{flat.length}</span>
      </div>

      <div className="row wrap">
        <button className="btn primary" disabled={locked || busy} onClick={() => act(() => api.runAgent(slug, 'drafts', '', picked.size ? [...picked] : undefined), 'Claude に依頼しました')}>
          <Icon name="spark" />{picked.size ? `選んだ ${picked.size} ショットを描き直す` : drafted.length ? 'ラフのないショットを描く' : 'ラフ絵コンテを作成'}</button>
        <button className="btn" disabled={locked || busy || !drafted.length} onClick={() => act(() => api.setStatus(slug, (picked.size ? [...picked] : drafted.map(x => x.shot.id)), 'approved'), '承認しました')}>
          <Icon name="check" />{picked.size ? `選んだ ${picked.size} ショットを承認` : 'ラフのあるショットをすべて承認'}</button>
        {picked.size > 0 && <button className="btn ghost" onClick={() => setPicked(new Set())}>選択を解除</button>}
        <span className="spacer" />
        <button className="btn primary lg" disabled={locked || busy} onClick={() => act(async () => { await api.patch(slug, { approvals: { ...p.approvals, drafts: true } }); onNext(); })}>本制作へ進む<Icon name="next" /></button>
      </div>
      {!drafted.length && <ClaudeSettings slug={slug} data={data} which="drafts" />}

      <div className="review">
        <div className="animatic">
          <div className="screen" style={{ ['--ar' as string]: ar, ['--arn' as string]: String(p.format.width / p.format.height) }}>
            {shown ? <img src={fileUrl(slug, `drafts/${cur!.shot.id}${endFrame ? '_b' : ''}.svg`, shown)} alt={`${cur!.shot.id} のラフ`} /> : <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#aaa' }}>{cur ? `${cur.shot.id}: ラフなし` : ''}</div>}
            {cur && <span className="tag">{cur.shot.id} · {cur.shot.title}</span>}
            {caption && p.captions !== 'none' && <span className="cap">{caption}</span>}
          </div>
        </div>
        <div className="inspector"><ShotInspector slug={slug} data={data} shotId={sel} save={save} locked={locked} fields="compact" /></div>
      </div>

      <Timeline slug={slug} data={data} t={pb.t} playing={pb.playing} onSeek={pb.seek} onToggle={pb.toggle} selected={sel} thumbs
        onSelect={id => { setSel(id); const s = flat.find(x => x.shot.id === id); if (s && !pb.playing) pb.seek(s.shot.start + .01); }} />

      <div className="boards" style={{ ['--ar' as string]: ar }}>
        {flat.map(({ shot: s }) => {
          const v = data.files.drafts[`${s.id}.svg`], isPicked = picked.has(s.id);
          return (
            <article key={s.id} className={`board ${sel === s.id ? 'sel' : ''}`}>
              <div className="frame" onClick={() => { setSel(s.id); pb.seek(s.start + .01); }}>
                {v ? <img src={fileUrl(slug, `drafts/${s.id}.svg`, v)} alt="" loading="lazy" /> : <span className="small muted">ラフなし</span>}
              </div>
              <div className="meta">
                <div className="row"><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={isPicked} onChange={() => togglePick(s.id)} aria-label={`${s.id} を選択`} /><b>{s.title}</b></label><span className="spacer" /><StatusChip status={s.status} /></div>
                <span className="small muted mono">{s.id} · {s.start.toFixed(1)}–{s.end.toFixed(1)}s{openCommentCount(s) ? ` · コメント ${openCommentCount(s)}` : ''}</span>
                <span className="small" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.action}</span>
                <div className="row">
                  <button className="btn sm" disabled={locked || !v || s.status === 'approved'} onClick={() => act(() => api.setStatus(slug, [s.id], 'approved'))}><Icon name="check" />承認</button>
                  <button className="btn sm ghost" disabled={locked} onClick={() => { setSel(s.id); setTimeout(() => document.getElementById(`comment-${s.id}`)?.focus(), 50); }}>コメント</button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
