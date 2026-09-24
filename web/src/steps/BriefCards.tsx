// BriefCards.tsx: Step 1 cards for the Claude connection and the visual approach (look).
import { useEffect, useState } from 'react';
import { api, type ProjectData } from '../api.ts';
import { Icon, useAction } from '../components/ui.tsx';

export function ConnectionCard({ slug, data }: { slug: string; data: ProjectData }) {
  const [busy, act] = useAction();
  const [checking, setChecking] = useState(false);
  const [keys, setKeys] = useState<{ saved: string | null; env: string | null; file: string | null } | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const p = data.project, info = p.authInfo;
  useEffect(() => { api.authStatus().then(setKeys).catch(() => {}); }, []);
  const choose = (mode: 'subscription' | 'apiKey') => act(() => api.patch(slug, { auth: mode }));
  const check = () => { setChecking(true); act(async () => { await api.checkAuth(slug); }).finally(() => setChecking(false)); };
  const hasKey = !!(keys?.saved || keys?.env);

  return (
    <section className="card stack" id="claude-connection">
      <div className="section-title"><h2>Claude の接続</h2><span className="small muted">エージェントがどのアカウント・課金で動くかを選びます</span></div>
      {data.mock && <p className="notice info">モックモード（STUDIO_MOCK=1）で起動しています。Claude は呼び出されません。</p>}
      <div className="choice-grid" role="radiogroup" aria-label="接続方法">
        <button className="choice" role="radio" aria-checked={p.auth === 'subscription'} onClick={() => choose('subscription')}>
          <b>サブスクリプション</b>
          <span>この PC の Claude Code のログイン（Pro / Max / Team プラン）の利用枠を使います。環境変数の API キーは使いません。</span>
        </button>
        <button className="choice" role="radio" aria-checked={p.auth === 'apiKey'} onClick={() => choose('apiKey')}>
          <b>API キー</b>
          <span>Anthropic の API キーで従量課金します。キーはプロジェクトの外（{keys?.file ? <code>{keys.file}</code> : 'ホームフォルダ'}）に保存され、git には入りません。</span>
        </button>
      </div>

      {p.auth === 'apiKey' && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row wrap small">
            {keys?.saved ? <span>保存済みのキー: <code>{keys.saved}</code></span> : keys?.env ? <span>環境変数 ANTHROPIC_API_KEY のキーを使います: <code>{keys.env}</code></span> : <span className="muted">キーがまだありません。</span>}
            {keys?.saved && <button className="btn sm ghost danger" onClick={() => act(async () => setKeys(await api.saveKey(null)), 'キーを削除しました')}>削除</button>}
          </div>
          <div className="row">
            <input className="input" id="api-key" type="password" autoComplete="off" placeholder="sk-ant-..." value={keyInput} onChange={e => setKeyInput(e.target.value)} />
            <button className="btn" disabled={!keyInput.trim() || busy} onClick={() => act(async () => { setKeys(await api.saveKey(keyInput)); setKeyInput(''); }, 'キーを保存しました')}>保存</button>
          </div>
        </div>
      )}

      {p.auth !== 'unset' && (
        <div className="row wrap">
          <button className="btn" disabled={checking || (p.auth === 'apiKey' && !hasKey)} onClick={check}>
            <Icon name="refresh" />{checking ? '確認中…（十数秒かかります）' : '接続を確認'}</button>
          {info && info.mode === p.auth && (
            <span className={`small ${info.ok ? '' : 'err-text'}`}>
              {info.ok ? <><span className="chip st-built">接続OK</span> {info.summary}</> : info.summary}
              <span className="muted"> · {new Date(info.at).toLocaleString('ja-JP')}</span>
            </span>
          )}
        </div>
      )}
      {p.auth === 'unset' && !data.mock && <p className="notice warn">接続方法を選ぶまで、Claude に作業を依頼できません。</p>}
      <p className="small muted">接続確認ではトークンを使いません。各工程の実行ログの先頭にも、実際に使った接続先が表示されます。サブスクリプションの場合、表示される金額は API 換算の目安です。</p>
    </section>
  );
}

export const LOOKS = [
  { id: 'auto', label: 'おまかせ', desc: 'ブリーフの画風に合う手法を Claude が選び、理由を構成案で説明します。' },
  { id: 'painted', label: '水彩・絵本', desc: 'p5.brush の水彩とインク線、紙の質感。元の PDoom と同じ描き方のキットを使います。' },
  { id: 'motion', label: 'モーショングラフィックス', desc: 'Canvas2D と GSAP。平面でもグラデーション・奥行き・光・質感を重ねて作り込みます。' },
  { id: 'sketch', label: '手描きスケッチ', desc: 'Rough.js の線画風。ラフな線に塗りと質感を重ねます。' },
  { id: '3d', label: '3D', desc: 'three.js。立体・ライティング・カメラワーク。' },
] as const;

export function LookCard({ slug, data }: { slug: string; data: ProjectData }) {
  const [, act] = useAction();
  const look = data.project.look;
  return (
    <section className="card stack">
      <div className="section-title"><h2>描き方</h2><span className="small muted">映像をどの技法で描くか。後の工程で変えることもできます</span></div>
      <div className="choice-grid five" role="radiogroup" aria-label="描き方">
        {LOOKS.map(l => (
          <button key={l.id} className="choice" role="radio" aria-checked={look === l.id} onClick={() => act(() => api.patch(slug, { look: l.id }))}>
            <b>{l.label}</b><span>{l.desc}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
