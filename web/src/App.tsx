// App.tsx: home (project list) and the project workspace with the stepper.
import { useEffect, useMemo, useState } from 'react';
import { api, type AgentTask, type Health, type ProjectData, type ProjectSummary, type StepId, useProject, useServerWaiting } from './api.ts';
import { AgentPanel } from './components/AgentPanel.tsx';
import { HistoryDrawer } from './components/Extras.tsx';
import { Icon, ToastProvider, useAction } from './components/ui.tsx';
import { BriefStep } from './steps/BriefStep.tsx';
import { BuildStep } from './steps/BuildStep.tsx';
import { DraftsStep } from './steps/DraftsStep.tsx';
import { ExportStep } from './steps/ExportStep.tsx';
import { PlanStep } from './steps/PlanStep.tsx';
import { ReviewStep } from './steps/ReviewStep.tsx';
import { openCommentCount, shotsOf } from './storyboard.ts';

const STEPS: { id: StepId; label: string; who: string; task?: AgentTask }[] = [
  { id: 'brief', label: 'ブリーフ', who: 'あなた' },
  { id: 'plan', label: '構成案', who: 'Claude', task: 'plan' },
  { id: 'review', label: '構成レビュー', who: '対話', task: 'review' },
  { id: 'drafts', label: 'ラフ絵コンテ', who: 'Claude', task: 'drafts' },
  { id: 'build', label: '本制作', who: 'Claude', task: 'build' },
  { id: 'export', label: '書き出し', who: '自動' },
];

function useRoute() {
  const parse = () => { const m = /^#\/p\/([a-z0-9-]+)(?:\/([a-z]+))?/.exec(location.hash); return m ? { slug: m[1], step: (m[2] as StepId) || null } : { slug: null, step: null }; };
  const [r, setR] = useState(parse);
  useEffect(() => { const f = () => setR(parse()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return r;
}

export default function App() {
  const r = useRoute();
  return <ToastProvider>{r.slug ? <Workspace key={r.slug} slug={r.slug} stepParam={r.step} /> : <Home />}<ServerBanner /></ToastProvider>;
}

// Shown while API requests are being retried (the server is starting or restarting after an edit).
function ServerBanner() {
  const waiting = useServerWaiting();
  return waiting ? <div className="server-wait" role="status"><span className="working"><i />サーバーの起動を待っています…</span></div> : null;
}

function Home() {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [name, setName] = useState('');
  const [busy, act] = useAction();
  useEffect(() => { api.projects().then(setList).catch(() => setList([])); api.health().then(setHealth).catch(() => {}); }, []);
  const create = () => act(async () => { const p = await api.create(name.trim(), {}); location.hash = `#/p/${p.slug}/brief`; });
  return (
    <div className="shell" style={{ gridTemplateRows: 'auto 1fr' }}>
      <header className="topbar"><a className="brand" href="#/"><span className="brand-mark" />Agent Video Studio</a></header>
      <main className="main">
        <div className="home">
          <div className="stack" style={{ gap: 8 }}>
            <h1>Claude と一緒に動画をつくる</h1>
            <p className="muted" style={{ maxWidth: '64ch' }}>ブリーフを書くと、Claude が構成案とストーリーボードを提案します。レビューとラフ絵コンテで方向を固めたら、Claude のエージェントたちがコードで映像を描き、MP4 に書き出します。</p>
          </div>
          <section className="card stack">
            <h2>新しいプロジェクト</h2>
            <div className="row">
              <input className="input" id="new-project" placeholder="例: 新サービス紹介ムービー" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && name.trim() && create()} />
              <button className="btn primary" disabled={!name.trim() || busy} onClick={create}><Icon name="plus" />作成</button>
            </div>
          </section>
          <section className="stack">
            <h2 style={{ fontSize: 16 }}>プロジェクト</h2>
            {list === null ? <p className="muted">読み込み中…</p> : !list.length ? <p className="muted">まだありません。</p> : (
              <div className="proj-list">
                {list.map(p => (
                  <a key={p.slug} className="proj" href={`#/p/${p.slug}/${p.step}`}>
                    <b>{p.name}</b>
                    <span className="small muted">{STEPS.find(s => s.id === p.step)?.label} · {p.shots} ショット{p.hasVideo ? ' · 動画あり' : ''}</span>
                    <span className="small muted tnum">{new Date(p.updatedAt).toLocaleString('ja-JP')}</span>
                  </a>
                ))}
              </div>
            )}
          </section>
          {health && (
            <section className="stack" style={{ gap: 6 }}>
              <span className="label">環境</span>
              <div className="env">
                <span className={health.chrome ? 'ok' : 'ng'}>Chrome {health.chrome ? '' : '（見つかりません: CHROME_PATH を設定）'}</span>
                <span className={health.ffmpeg ? 'ok' : 'ng'}>ffmpeg</span>
                <span className={health.git ? 'ok' : 'ng'}>git（履歴）</span>
                {health.mock && <span className="ok">Claude: モック（STUDIO_MOCK=1）</span>}
                <span>保存先: <span className="mono">{health.projectsDir}</span></span>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function stepDone(id: StepId, d: ProjectData) {
  const shots = shotsOf(d.storyboard).map(x => x.shot);
  switch (id) {
    case 'brief': return !!(d.brief.theme.trim() || d.brief.purpose.trim());
    case 'plan': return d.storyboard.chapters.length > 0;
    case 'review': return d.project.approvals.storyboard;
    case 'drafts': return d.project.approvals.drafts;
    case 'build': return shots.length > 0 && shots.every(s => s.status === 'built');
    case 'export': return d.files.finalVideo > 0;
  }
}

function Workspace({ slug, stepParam }: { slug: string; stepParam: StepId | null }) {
  const { data, error, chat, render, tts, version, setRender } = useProject(slug);
  const [sel, setSel] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState(true);
  const [history, setHistory] = useState(false);
  const step: StepId = stepParam || data?.project.step || 'brief';
  const go = (s: StepId) => { location.hash = `#/p/${slug}/${s}`; setPicked(new Set()); api.patch(slug, { step: s }).catch(() => {}); };
  useEffect(() => { if (data && !sel) setSel(shotsOf(data.storyboard)[0]?.shot.id ?? null); }, [data, sel]);
  useEffect(() => { if (data) document.title = `${data.project.name} · Agent Video Studio`; }, [data?.project.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const agentCfg = useMemo(() => {
    if (!data) return null;
    const open = shotsOf(data.storyboard).reduce((n, x) => n + openCommentCount(x.shot), 0);
    const comments = open ? `未対応のコメント ${open} 件も一緒に送ります。` : undefined;
    switch (step) {
      case 'plan': return data.storyboard.chapters.length
        ? { task: 'review' as const, placeholder: '構成について質問や修正の依頼を書いてください', hint: comments }
        : { task: 'plan' as const, placeholder: '構成案への追加の指示（任意）', hint: 'ブリーフをもとに構成案を作ります。' };
      case 'review': return { task: 'review' as const, placeholder: '例: 2章をもっと短く。最後にロゴのショットを足して', hint: comments };
      case 'drafts': return { task: 'drafts' as const, placeholder: picked.size ? `選んだ ${picked.size} ショットについての指示` : 'ラフについての指示（例: 全体にもっと引きの構図で）', hint: picked.size ? `選んだ ${picked.size} ショットを描き直します。${comments || ''}` : comments, shotIds: picked.size ? [...picked] : undefined };
      case 'build': return picked.size
        ? { task: 'retake' as const, placeholder: `選んだ ${picked.size} ショットの直してほしい点`, hint: comments, shotIds: [...picked] }
        : { task: 'build' as const, placeholder: '制作についての指示（例: 2章の背景をもっと動かして）', hint: comments };
      default: return null;
    }
  }, [data, step, picked]);

  if (error && !data) return <div className="home"><p className="notice err">{error}</p><a href="#/">プロジェクト一覧へ</a></div>;
  if (!data) return <div className="home"><p className="muted">読み込み中…</p></div>;
  const idx = STEPS.findIndex(s => s.id === step);
  const next = () => go(STEPS[Math.min(STEPS.length - 1, idx + 1)].id);

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/" title="プロジェクト一覧"><span className="brand-mark" /></a>
        <span className="project-name" title={data.project.name}>{data.project.name}</span>
        <nav className="stepper" aria-label="工程">
          {STEPS.map((s, i) => {
            const done = stepDone(s.id, data), busy = data.running && (data.running.task === s.task || (s.id === 'build' && data.running.task === 'retake') || (s.id === 'review' && data.running.task === 'review'));
            return (
              <button key={s.id} className={`step ${done ? 'done' : ''} ${s.id === step ? 'current' : ''} ${busy ? 'busy' : ''}`} onClick={() => go(s.id)} aria-current={s.id === step ? 'step' : undefined}>
                <span className="n">{done && !busy ? <Icon name="check" className="icon" /> : i + 1}</span>
                <span className="t"><span>{s.label}</span><span className="who">{s.who}</span></span>
              </button>
            );
          })}
        </nav>
        {data.exporting && <span className="working small"><i />書き出し中</span>}
        <button className="btn ghost sm" onClick={() => setHistory(true)}><Icon name="history" />履歴</button>
      </header>
      <div className="work">
        <main className="main">
          {step === 'brief' && <BriefStep slug={slug} data={data} onNext={next} />}
          {step === 'plan' && <PlanStep slug={slug} data={data} onNext={next} />}
          {step === 'review' && <ReviewStep slug={slug} data={data} sel={sel} setSel={setSel} onNext={next} tts={tts} />}
          {step === 'drafts' && <DraftsStep slug={slug} data={data} sel={sel} setSel={setSel} picked={picked} setPicked={setPicked} onNext={next} tts={tts} />}
          {step === 'build' && <BuildStep slug={slug} data={data} version={version} sel={sel} setSel={setSel} picked={picked} setPicked={setPicked} onNext={next} />}
          {step === 'export' && <ExportStep slug={slug} data={data} render={render} clearRender={() => setRender(null)} />}
        </main>
        {agentCfg && <AgentPanel slug={slug} data={data} chat={chat} task={agentCfg.task} placeholder={agentCfg.placeholder} hint={agentCfg.hint} shotIds={agentCfg.shotIds} collapsed={!panel} onToggle={() => setPanel(v => !v)} />}
      </div>
      {history && <HistoryDrawer slug={slug} onClose={() => setHistory(false)} locked={!!data.running} />}
    </div>
  );
}
