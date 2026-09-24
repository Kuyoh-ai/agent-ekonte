// ExportStep.tsx: step 6. Render every frame in parallel, mix audio, encode the MP4 and play it back.
import { useState } from 'react';
import { api, fileUrl, fmtTime, type ProjectData, type RenderState } from '../api.ts';
import { Icon, useAction } from '../components/ui.tsx';
import { shotsOf } from '../storyboard.ts';

const JOB_LABEL: Record<string, string> = { prepare: '準備', frames: 'フレームを描画', encode: 'MP4 にエンコード', export: '書き出し' };

export function ExportStep({ slug, data, render, clearRender }: { slug: string; data: ProjectData; render: RenderState | null; clearRender: () => void }) {
  const [busy, act] = useAction();
  const [workers, setWorkers] = useState(4);
  const [fresh, setFresh] = useState(false);
  const p = data.project, flat = shotsOf(data.storyboard);
  const notBuilt = flat.filter(x => x.shot.status !== 'built');
  const total = Math.round(p.format.duration * p.format.fps);
  const running = data.exporting;
  const pct = render && render.total ? Math.round((render.done || 0) / render.total * 100) : 0;
  const done = render?.job === 'export' && render.phase === 'done';
  const failed = render?.phase === 'error';

  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Step 6 · 自動</span>
          <h1>書き出し</h1>
          <p>ヘッドレス Chrome で全フレームを並列に描き、音声と合わせて MP4 にします。途中で止めても、次回は描き終わったフレームを飛ばして再開します。</p>
        </div>
      </div>

      {notBuilt.length > 0 && <p className="notice warn">完成していないショットが {notBuilt.length} 個あります（{notBuilt.slice(0, 6).map(x => x.shot.id).join(', ')}{notBuilt.length > 6 ? ' ほか' : ''}）。このまま書き出すこともできます。</p>}

      <section className="card stack">
        <div className="kpis">
          <div className="kpi"><b>{p.format.width}×{p.format.height}</b><span>解像度</span></div>
          <div className="kpi"><b>{p.format.fps} fps</b><span>フレームレート</span></div>
          <div className="kpi"><b>{fmtTime(p.format.duration)}</b><span>長さ</span></div>
          <div className="kpi"><b>{data.files.frames}/{total}</b><span>描画済みフレーム</span></div>
          <div className="kpi"><b>{p.audio.music?.file || p.audio.narration.enabled ? 'あり' : 'なし'}</b><span>音声</span></div>
        </div>
        <div className="row wrap" style={{ gap: 16 }}>
          <label className="row">並列数
            <select className="input" style={{ width: 'auto' }} value={workers} onChange={e => setWorkers(+e.target.value)} disabled={running}>{[1, 2, 3, 4, 6, 8, 12].map(n => <option key={n}>{n}</option>)}</select>
          </label>
          <label className="row"><input type="checkbox" checked={fresh} onChange={e => setFresh(e.target.checked)} disabled={running} />描画済みフレームを捨てて最初から</label>
          <span className="spacer" />
          {running
            ? <button className="btn danger" onClick={() => act(() => api.cancelExport(slug), '停止しました')}><Icon name="stop" />停止</button>
            : <button className="btn primary lg" disabled={busy || !!data.running} onClick={() => { clearRender(); act(() => api.exportVideo(slug, workers, fresh)); }}><Icon name="film" />書き出す</button>}
        </div>
        <p className="small muted">並列数を増やすと速くなりますが、メモリと GPU を多く使います。コードを変えたショットだけ描き直したいときは「最初から」を選んでください。</p>
        {data.running && <p className="notice info">Claude の作業が終わってから書き出せます。</p>}
      </section>

      {render && (
        <section className="card stack" aria-live="polite">
          <div className="row">
            <b>{JOB_LABEL[render.job] || render.job}</b>
            <span className="small muted tnum">
              {render.phase === 'progress' && render.total ? `${render.done}/${render.total} · ${render.msPerFrame ?? '–'} ms/フレーム${render.etaSec ? ` · 残り約 ${Math.ceil(render.etaSec / 60)} 分` : ''}` : ''}
              {done ? '完了' : failed ? '失敗' : ''}
            </span>
          </div>
          {render.job === 'frames' && <div className="progress"><i style={{ width: `${pct}%` }} /></div>}
          {failed && <p className="notice err" style={{ whiteSpace: 'pre-wrap' }}>{render.message}</p>}
          {render.log.length > 0 && <div className="log">{render.log.slice(-40).join('\n')}</div>}
        </section>
      )}

      {data.files.finalVideo > 0 && (
        <section className="card stack">
          <div className="row"><h2>完成した動画</h2><span className="spacer" />
            <a className="btn" href={fileUrl(slug, 'out/final.mp4', data.files.finalVideo)} download={`${slug}.mp4`}><Icon name="download" />ダウンロード</a></div>
          <video className="final" controls src={fileUrl(slug, 'out/final.mp4', data.files.finalVideo)} />
          <p className="small muted">保存場所: <span className="mono">projects/{slug}/out/final.mp4</span></p>
        </section>
      )}
    </div>
  );
}
