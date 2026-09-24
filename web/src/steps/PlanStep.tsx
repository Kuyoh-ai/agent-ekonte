// PlanStep.tsx: step 2. Claude turns the brief into a timeline (chapters → shots) and a style guide.
import { useState } from 'react';
import { api, fmtTime, type ProjectData } from '../api.ts';
import { ClaudeSettings } from '../components/Extras.tsx';
import { Icon, Markdown, StatusChip, useAction } from '../components/ui.tsx';

export function PlanStep({ slug, data, onNext }: { slug: string; data: ProjectData; onNext: () => void }) {
  const [note, setNote] = useState('');
  const [busy, act] = useAction();
  const sb = data.storyboard, running = data.running?.task === 'plan';
  const has = sb.chapters.length > 0;
  const shots = sb.chapters.reduce((n, c) => n + c.shots.length, 0);
  const start = () => act(async () => { await api.runAgent(slug, 'plan', note); setNote(''); });

  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Step 2 · Claude</span>
          <h1>構成案</h1>
          <p>Claude がブリーフから、章とショットのタイムライン（ストーリーボード）と、制作の指針になるスタイルガイドを提案します。</p>
        </div>
        <span className="spacer" />
        {has && <button className="btn primary lg" disabled={running} onClick={onNext}>レビューへ進む<Icon name="next" /></button>}
      </div>

      {!has && !running && (
        <section className="card stack">
          <h2>Claude に依頼する内容</h2>
          <ul className="md" style={{ margin: 0 }}>
            <li>動画を章（場面のまとまり）とショット（1.5〜6 秒ほどのカット）に分け、それぞれで画面に何が起きるかを決めます。</li>
            <li>{data.project.audio.music?.file ? '曲の小節と歌詞の区切りにカットを合わせます。' : data.project.audio.narration.enabled ? '各ショットのナレーション台本も書きます。' : `全体の長さは約 ${data.project.format.duration} 秒で組みます。`}</li>
            <li>配色・文字・キャラクター・動きの方針をスタイルガイド（style.md）にまとめ、どの描画ライブラリで作るかも決めます。</li>
          </ul>
          <label className="field"><span>追加の指示（任意）</span>
            <textarea className="input" rows={2} placeholder="例: 章は4つくらいで。サビは毎回同じステージに戻ってくる構成にしたい" value={note} onChange={e => setNote(e.target.value)} />
          </label>
          <ClaudeSettings slug={slug} data={data} which="planning" />
          <div className="row"><span className="spacer" /><button className="btn primary lg" disabled={busy || !!data.running} onClick={start}><Icon name="spark" />構成案を作成</button></div>
        </section>
      )}

      {running && !has && (
        <section className="empty" aria-live="polite">
          <span className="working"><i />Claude が構成を考えています。右のパネルで進み具合を見られます。</span>
          <span className="small">長さや内容によって数分かかります。</span>
        </section>
      )}

      {has && (
        <>
          <section className="card stack">
            <div className="row wrap">
              <div className="stack" style={{ gap: 2 }}>
                <span className="label">コンセプト</span>
                <h2 style={{ fontSize: 18 }}>{sb.logline || '（ログラインなし）'}</h2>
              </div>
              <span className="spacer" />
              <span className="small muted tnum">{sb.chapters.length} 章 · {shots} ショット · {fmtTime(sb.chapters.at(-1)!.end)}</span>
            </div>
            <div className="chapters-list">
              {sb.chapters.map(c => (
                <div className="ch-row" key={c.id}>
                  <div className="bar" style={{ background: c.palette[1] || c.palette[0] || 'var(--line-2)' }} />
                  <div className="stack" style={{ gap: 4 }}>
                    <div className="row wrap"><b>{c.title}</b><span className="mono small muted">{c.id} · {fmtTime(c.start)}–{fmtTime(c.end)}</span>
                      <span className="palette">{c.palette.map(h => <i key={h} style={{ background: h }} title={h} />)}</span></div>
                    {c.summary && <p className="small muted">{c.summary}</p>}
                    <div className="shot-list">
                      {c.shots.map(s => (
                        <div className="shot-line" key={s.id} style={{ cursor: 'default' }}>
                          <span className="mono small muted">{s.id}</span>
                          <span className="mono small tnum">{s.start.toFixed(1)}–{s.end.toFixed(1)}s</span>
                          <span className="small"><b>{s.title}</b> — {s.action}{s.narration && <span className="muted">　「{s.narration}」</span>}</span>
                          <StatusChip status={s.status} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <div className="card-head"><h2>スタイルガイド</h2><span className="small muted">style.md · レビュー画面で編集できます</span></div>
            {data.style.trim() ? <Markdown text={data.style} /> : <p className="muted">まだありません。</p>}
          </section>
          <section className="card flat stack">
            <h2 style={{ fontSize: 15 }}>方向性ごと作り直す</h2>
            <p className="small muted">部分的な修正は次のレビューで行えます。方向性から変えたい場合だけ、ここで作り直してください（今の案は履歴に残ります）。</p>
            <textarea className="input" rows={2} placeholder="例: もっと短く、テンポよく。主人公を猫に変えて" value={note} onChange={e => setNote(e.target.value)} />
            <div className="row"><span className="spacer" /><button className="btn" disabled={busy || !!data.running} onClick={start}><Icon name="refresh" />作り直す</button></div>
          </section>
        </>
      )}
    </div>
  );
}
