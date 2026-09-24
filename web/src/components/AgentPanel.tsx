// AgentPanel.tsx: the conversation with Claude. Shows every run's messages and tool activity, sends the next request.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, fmtUsd, type AgentTask, type Asset, type ChatEntry, type ProjectData } from '../api.ts';
import { Icon, useAction } from './ui.tsx';
import { AssetChips, MentionText } from './Assets.tsx';

export const TASK_LABEL: Record<string, string> = { plan: '構成案', review: 'レビュー', drafts: 'ラフ絵コンテ', build: '本制作', retake: 'リテイク' };

interface Props {
  slug: string; data: ProjectData; chat: ChatEntry[];
  task: AgentTask;                       // what the input box sends
  placeholder: string;
  hint?: string;                         // shown above the input (e.g. "3件の未対応コメントも一緒に送ります")
  shotIds?: string[];
  canSend?: boolean;
  collapsed: boolean; onToggle: () => void;
}

export function AgentPanel({ slug, data, chat, task, placeholder, hint, shotIds, canSend = true, collapsed, onToggle }: Props) {
  const [text, setText] = useState('');
  const [onlyStep, setOnlyStep] = useState(false);
  const [busy, act] = useAction();
  const logRef = useRef<HTMLDivElement>(null);
  const running = data.running;
  const related = useMemo(() => new Set(task === 'retake' || task === 'build' ? ['build', 'retake'] : task === 'review' || task === 'plan' ? ['plan', 'review'] : [task]), [task]);
  const shown = onlyStep ? chat.filter(e => related.has(e.task)) : chat;

  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [shown.length, collapsed]);

  const send = () => act(async () => { await api.runAgent(slug, task, text, shotIds); setText(''); });

  if (collapsed) return (
    <aside className="agent collapsed">
      <button className="btn ghost" style={{ margin: 6 }} onClick={onToggle} title="Claude パネルを開く" aria-label="Claude パネルを開く"><Icon name="chat" /></button>
      {running && <div className="working" style={{ justifyContent: 'center' }}><i /></div>}
    </aside>
  );

  let lastTask = '';
  return (
    <aside className="agent" aria-label="Claude">
      <div className="agent-head">
        <b>Claude</b>
        <span className="muted small">累計 {fmtUsd(data.project.costUsd)}</span>
        <span className="spacer" />
        <label className="row small muted" style={{ gap: 4 }}><input type="checkbox" checked={onlyStep} onChange={e => setOnlyStep(e.target.checked)} />この工程だけ</label>
        <button className="btn ghost sm" onClick={onToggle} title="たたむ" aria-label="パネルをたたむ"><Icon name="panel" /></button>
      </div>
      <div className="agent-log" ref={logRef} aria-live="polite">
        {!shown.length && <p className="muted small">ここに Claude とのやりとりと作業の記録が表示されます。</p>}
        {shown.map(e => {
          const sep = e.task !== lastTask ? <div className="task-sep" key={e.id + 's'}>{TASK_LABEL[e.task] || e.task}</div> : null;
          lastTask = e.task;
          return [sep, <Entry key={e.id} e={e} slug={slug} assets={data.project.assets} />];
        })}
      </div>
      <div className="agent-input">
        {running ? (
          <div className="row">
            <span className="working"><i />{TASK_LABEL[running.task]}の作業中…</span>
            <span className="spacer" />
            <button className="btn sm danger" onClick={() => act(() => api.stopAgent(slug), '停止を依頼しました')}><Icon name="stop" />停止</button>
          </div>
        ) : hint ? <p className="small muted">{hint}</p> : null}
        <AssetChips slug={slug} assets={data.project.assets} targetId={`agent-input-${task}`} value={text} onChange={setText} />
        <textarea className="input" id={`agent-input-${task}`} value={text} placeholder={placeholder} disabled={!!running || !canSend}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !running && (text.trim() || hint)) { e.preventDefault(); send(); } }} />
        <div className="row">
          <span className="small muted">{TASK_LABEL[task]}として送信 · Ctrl+Enter</span>
          <span className="spacer" />
          <button className="btn primary sm" disabled={!!running || busy || !canSend || (!text.trim() && !hint)} onClick={send}><Icon name="send" />送信</button>
        </div>
      </div>
    </aside>
  );
}

function Entry({ e, slug, assets }: { e: ChatEntry; slug: string; assets: Asset[] }) {
  if (e.role === 'tool') return <div className="msg tool">{e.sub && <span className="sub">[{e.sub}] </span>}{e.text}</div>;
  if (e.role === 'result') return <div className="msg result">✓ {e.text}{e.costUsd ? ` · ${fmtUsd(e.costUsd)}` : ''}</div>;
  return <div className={`msg ${e.role}`}><MentionText text={e.text} slug={slug} assets={assets} /></div>;
}
