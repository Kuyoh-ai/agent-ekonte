// Extras.tsx: version history drawer and the Claude settings (model / effort / budget) block.
import { useEffect, useState } from 'react';
import { api, type ProjectData, type Revision } from '../api.ts';
import { Icon, useAction } from './ui.tsx';

export function HistoryDrawer({ slug, onClose, locked }: { slug: string; onClose: () => void; locked: boolean }) {
  const [revs, setRevs] = useState<Revision[] | null>(null);
  const [busy, act] = useAction();
  const load = () => api.history(slug).then(setRevs).catch(() => setRevs([]));
  useEffect(() => { load(); }, [slug]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" onClick={e => e.stopPropagation()} role="dialog" aria-label="履歴">
        <div className="drawer-head">
          <h2 style={{ fontSize: 16 }}>履歴</h2>
          <span className="spacer" />
          <button className="btn sm" disabled={busy} onClick={() => act(async () => { await api.saveVersion(slug, '手動で保存'); await load(); }, '現在の状態を保存しました')}>今の状態を保存</button>
          <button className="btn ghost sm" onClick={onClose} aria-label="閉じる">✕</button>
        </div>
        <div className="drawer-body">
          <p className="small muted">Claude の作業の前後と手動保存のたびに記録されます。復元しても、復元前の状態は履歴に残ります。</p>
          {revs === null && <p className="muted">読み込み中…</p>}
          {revs?.length === 0 && <p className="muted">履歴がありません（git が見つからない場合は記録されません）。</p>}
          {revs?.map((r, i) => (
            <div className="rev" key={r.id}>
              <b style={{ fontSize: 13.5 }}>{r.message}</b>
              <small className="tnum">{new Date(r.at).toLocaleString('ja-JP')} · {r.files} ファイル · <span className="mono">{r.id}</span></small>
              {i > 0 && <button className="btn sm" disabled={busy || locked} title={locked ? 'Claude の作業中は復元できません' : ''}
                onClick={() => act(async () => { await api.restore(slug, r.id); await load(); }, 'この時点に戻しました')}><Icon name="history" />この時点に戻す</button>}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

const MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5（標準）' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1（最上位・高価）' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5（速い・安い）' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5（最速）' },
];
const EFFORTS = [['low', '低'], ['medium', '中'], ['high', '高'], ['xhigh', '特高'], ['max', '最大']] as const;

export function ClaudeSettings({ slug, data, which }: { slug: string; data: ProjectData; which: 'planning' | 'drafts' | 'production' }) {
  const [, act] = useAction();
  const p = data.project;
  return (
    <details className="card flat" style={{ padding: '10px 14px' }}>
      <summary style={{ cursor: 'pointer' }} className="small"><b>Claude の設定</b> <span className="muted">· {MODELS.find(m => m.id === p.models[which])?.label || p.models[which]} · 思考量 {EFFORTS.find(e => e[0] === p.effort)?.[1]}{p.budgetUsd ? ` · 上限 $${p.budgetUsd}` : ''}</span></summary>
      <div className="grid2" style={{ marginTop: 12 }}>
        <label className="field"><span>モデル（この工程）</span>
          <select className="input" value={p.models[which]} onChange={e => act(() => api.patch(slug, { models: { ...p.models, [which]: e.target.value } }))}>
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            {!MODELS.some(m => m.id === p.models[which]) && <option value={p.models[which]}>{p.models[which]}</option>}
          </select>
        </label>
        <label className="field"><span>思考量（effort）</span>
          <select className="input" value={p.effort} onChange={e => act(() => api.patch(slug, { effort: e.target.value as never }))}>
            {EFFORTS.map(([v, l]) => <option key={v} value={v}>{l}（{v}）</option>)}
          </select>
          <small>高いほど丁寧ですが、時間と費用が増えます。</small>
        </label>
        <label className="field"><span>1回の実行の費用上限（USD）</span>
          <input className="input num" type="number" min="0" step="1" defaultValue={p.budgetUsd || ''} placeholder="なし"
            onBlur={e => act(() => api.patch(slug, { budgetUsd: Math.max(0, +e.target.value || 0) }))} />
          <small>API キーで使う場合の目安です。0 または空欄で上限なし。</small>
        </label>
      </div>
    </details>
  );
}
