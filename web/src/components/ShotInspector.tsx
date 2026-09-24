// ShotInspector.tsx: edit one shot's fields and discuss it in comments.
import { useEffect, useState } from 'react';
import { api, fmtTime, type ProjectData, type Shot, type Storyboard } from '../api.ts';
import { findShot, patchShot, removeShot, setDuration, splitShot } from '../storyboard.ts';
import { Icon, StatusChip, useAction } from './ui.tsx';

interface Props {
  slug: string; data: ProjectData; shotId: string | null;
  save: (sb: Storyboard, msg?: string) => Promise<void>;
  locked: boolean;           // Claude is working: no manual edits
  fields?: 'full' | 'compact';
}

const FIELDS: { key: keyof Shot; label: string; hint: string; rows: number }[] = [
  { key: 'action', label: '内容', hint: '画面で何が起きるか', rows: 3 },
  { key: 'visual', label: '画づくり', hint: '構図・カメラ・色', rows: 2 },
  { key: 'transition', label: 'つなぎ', hint: '次のショットへの移り方', rows: 2 },
  { key: 'audioCue', label: '音のきっかけ', hint: '歌詞・拍・効果音', rows: 1 },
  { key: 'onScreenText', label: '画面上の文字', hint: '必要な場合だけ', rows: 1 },
];

export function ShotInspector({ slug, data, shotId, save, locked, fields = 'full' }: Props) {
  const hit = findShot(data.storyboard, shotId);
  const [form, setForm] = useState<Partial<Shot>>({});
  const [comment, setComment] = useState('');
  const [busy, act] = useAction();
  useEffect(() => { setForm({}); }, [shotId]);
  if (!hit) return <div className="card flat"><p className="muted">タイムラインのショットを選ぶと、ここで内容の編集とコメントができます。</p></div>;
  const { shot, chapter } = hit;
  const val = <K extends keyof Shot>(k: K) => (form[k] ?? shot[k]) as Shot[K];
  const dirty = Object.keys(form).some(k => form[k as keyof Shot] !== shot[k as keyof Shot]);
  const freeLength = !data.project.audio.music?.file;
  const narration = data.project.audio.narration.enabled;
  const commit = () => act(() => save(patchShot(data.storyboard, shot.id, form), 'ショットを保存しました'));

  return (
    <div className="card flat stack">
      <div className="row wrap">
        <span className="label">{chapter.title || chapter.id} · {shot.id}</span>
        <span className="spacer" />
        <StatusChip status={shot.status} />
      </div>
      <input className="input shot-title" style={{ fontWeight: 700 }} value={val('title')} disabled={locked} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} aria-label="ショット名" />
      <div className="row wrap small tnum">
        <span className="mono">{fmtTime(shot.start)} → {fmtTime(shot.end)}</span>
        <span className="muted">（{(shot.end - shot.start).toFixed(2)} 秒）</span>
        {freeLength && !locked && (
          <label className="row" style={{ gap: 4 }}>長さ
            <input className="input num" type="number" step="0.1" min="0.3" defaultValue={(shot.end - shot.start).toFixed(2)} key={shot.id + shot.end}
              onBlur={e => { const v = +e.target.value; if (v > 0 && Math.abs(v - (shot.end - shot.start)) > .005) act(() => save(setDuration(data.storyboard, shot.id, v), '長さを変更しました')); }} />秒
          </label>
        )}
      </div>
      {shot.statusNote && <p className="small muted">メモ: {shot.statusNote}</p>}
      {(fields === 'full' ? FIELDS : FIELDS.slice(0, 2)).map(f => (
        <label className="field" key={f.key}>
          <span>{f.label} <small className="muted" style={{ fontWeight: 400 }}>{f.hint}</small></span>
          <textarea className="input" rows={f.rows} value={String(val(f.key) ?? '')} disabled={locked} onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))} />
        </label>
      ))}
      {narration && (
        <label className="field">
          <span>ナレーション {shot.narrationAudio ? <small className="muted" style={{ fontWeight: 400 }}>音声 {shot.narrationAudio.duration.toFixed(1)} 秒</small> : <small className="muted" style={{ fontWeight: 400 }}>未合成</small>}</span>
          <textarea className="input" rows={2} value={val('narration')} disabled={locked} onChange={e => setForm(x => ({ ...x, narration: e.target.value }))} />
        </label>
      )}
      <div className="row wrap">
        <button className="btn primary sm" disabled={!dirty || locked || busy} onClick={commit}><Icon name="check" />保存</button>
        {dirty && <button className="btn sm ghost" onClick={() => setForm({})}>元に戻す</button>}
        <span className="spacer" />
        {fields === 'full' && !locked && <>
          <button className="btn sm ghost" title="このショットを半分に分ける" onClick={() => act(() => save(splitShot(data.storyboard, shot.id), 'ショットを分割しました'))}><Icon name="split" />分割</button>
          <button className="btn sm ghost danger" title="このショットを削除（時間は前のショットに渡す）" disabled={chapter.shots.length < 2}
            onClick={() => act(() => save(removeShot(data.storyboard, shot.id), 'ショットを削除しました'))}><Icon name="trash" />削除</button>
        </>}
      </div>

      <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <span className="label">コメント</span>
        <div className="comments">
          {!shot.comments.length && <p className="small muted">気になる点をコメントすると、Claude に送るときにまとめて渡します。</p>}
          {shot.comments.map(c => (
            <div key={c.id} className={`comment ${c.author} ${c.resolved ? 'resolved' : ''}`}>
              <header><b>{c.author === 'user' ? 'あなた' : 'Claude'}</b><span>{new Date(c.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                {c.author === 'user' && <>
                  <span className="spacer" />
                  <button className="btn ghost sm" onClick={() => act(() => api.editComment(slug, shot.id, c.id, { resolved: !c.resolved }))}>{c.resolved ? '未対応に戻す' : '対応済みにする'}</button>
                  {!c.resolved && <button className="btn ghost sm danger" aria-label="コメントを削除" onClick={() => act(() => api.editComment(slug, shot.id, c.id, { delete: true }))}><Icon name="trash" /></button>}
                </>}
              </header>
              <p style={{ whiteSpace: 'pre-wrap' }}>{c.text}</p>
            </div>
          ))}
        </div>
        <textarea className="input" id={`comment-${shot.id}`} rows={2} placeholder="例: もっと寄りで、驚いた表情を大きく" value={comment} onChange={e => setComment(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && comment.trim()) { e.preventDefault(); act(async () => { await api.comment(slug, shot.id, comment); setComment(''); }); } }} />
        <div className="row"><span className="spacer" />
          <button className="btn sm" disabled={!comment.trim() || busy} onClick={() => act(async () => { await api.comment(slug, shot.id, comment); setComment(''); })}>コメントを追加</button>
        </div>
      </div>
    </div>
  );
}
