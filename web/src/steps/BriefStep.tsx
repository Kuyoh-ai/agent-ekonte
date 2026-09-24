// BriefStep.tsx: step 1. The user sets theme, purpose, flow and look, the video format, and the audio.
import { useEffect, useRef, useState } from 'react';
import { api, fileUrl, fmtTime, type Brief, type ProjectData, type Tempo } from '../api.ts';
import { Icon, useAction, useToast } from '../components/ui.tsx';
import { ConnectionCard, LookCard } from './BriefCards.tsx';
import { AssetsCard } from '../components/Assets.tsx';

const BRIEF_FIELDS: { key: keyof Brief; label: string; hint: string; rows: number; placeholder: string }[] = [
  { key: 'theme', label: 'テーマ・伝えたいこと', hint: '何についての動画で、見た人に何を残したいか', rows: 3, placeholder: '例: 小さなロボットが初めて朝日を見る。新しいことを始める勇気' },
  { key: 'purpose', label: '目的・使い道', hint: 'どこで誰に見せ、何を達成したいか', rows: 2, placeholder: '例: 新サービス発表イベントのオープニング映像。会場を温めたい' },
  { key: 'audience', label: '見る人', hint: '', rows: 1, placeholder: '例: 20〜40代の開発者' },
  { key: 'flow', label: '動画の流れ', hint: '始まり → 中盤 → 終わり。大まかでかまいません', rows: 4, placeholder: '例: 暗い倉庫で目覚める → 外に出て失敗を繰り返す → 仲間と朝日を見る → ロゴ' },
  { key: 'tone', label: 'トーン', hint: '', rows: 1, placeholder: '例: かわいい、前向き、少しコミカル' },
  { key: 'visualStyle', label: 'デザイン・画風', hint: '色、質感、参考にしたい雰囲気', rows: 2, placeholder: '例: 絵本のような水彩。オレンジと青緑。線はやわらかく' },
  { key: 'references', label: '参考', hint: '作品名、URL など', rows: 1, placeholder: '' },
  { key: 'mustHave', label: '必ず入れたいもの', hint: '', rows: 1, placeholder: '例: 最後にロゴと「Hello, world」' },
  { key: 'avoid', label: '避けたいもの', hint: '', rows: 1, placeholder: '例: 暗すぎる表現、文字の多い画面' },
  { key: 'notes', label: 'その他のメモ', hint: '', rows: 2, placeholder: '' },
];
const PRESETS = [
  { label: '16:9 フルHD', w: 1920, h: 1080 }, { label: '16:9 HD', w: 1280, h: 720 },
  { label: '9:16 縦長', w: 1080, h: 1920 }, { label: '1:1 正方形', w: 1080, h: 1080 },
];

export function BriefStep({ slug, data, onNext }: { slug: string; data: ProjectData; onNext: () => void }) {
  const [brief, setBrief] = useState<Brief>(data.brief);
  const [saved, setSaved] = useState(true);
  const [busy, act] = useAction();
  const p = data.project;
  useEffect(() => { if (saved) setBrief(data.brief); }, [data.brief]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveBrief = () => act(async () => { await api.saveBrief(slug, brief); setSaved(true); });
  const setField = (k: keyof Brief, v: string) => { setBrief(b => ({ ...b, [k]: v })); setSaved(false); };
  const hasBrief = !!(brief.theme.trim() || brief.purpose.trim());
  const connected = data.mock || p.auth !== 'unset';
  const ready = hasBrief && connected;

  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Step 1 · あなた</span>
          <h1>ブリーフ</h1>
          <p>どんな動画にしたいかを書いてください。大まかで大丈夫です。細かいところは次の工程で Claude と一緒に詰めます。</p>
        </div>
        <span className="spacer" />
        <button className="btn primary lg" disabled={!ready || busy} onClick={async () => { if (!saved) await api.saveBrief(slug, brief); onNext(); }}>構成案へ進む<Icon name="next" /></button>
      </div>

      <ConnectionCard slug={slug} data={data} />

      <section className="card stack">
        <div className="section-title"><h2>内容</h2><span className="small muted">{saved ? '保存済み' : '未保存の変更があります（入力欄から離れると保存）'}</span></div>
        <label className="field"><span>タイトル（仮）</span>
          <input className="input" value={brief.title} onChange={e => setField('title', e.target.value)} onBlur={saveBrief} />
        </label>
        <div className="grid2">
          {BRIEF_FIELDS.map(f => (
            <label className="field" key={f.key} style={f.rows >= 3 ? { gridColumn: '1 / -1' } : undefined}>
              <span>{f.label}</span>{f.hint && <small>{f.hint}</small>}
              <textarea className="input" id={`brief-${f.key}`} rows={f.rows} placeholder={f.placeholder} value={brief[f.key]} onChange={e => setField(f.key, e.target.value)} onBlur={saveBrief} />
            </label>
          ))}
        </div>
      </section>

      <AssetsCard slug={slug} data={data} />
      <LookCard slug={slug} data={data} />
      <FormatCard slug={slug} data={data} />
      <MusicCard slug={slug} data={data} />
      <NarrationCard slug={slug} data={data} />
      {!hasBrief && <p className="notice info">「テーマ・伝えたいこと」か「目的・使い道」を書くと次へ進めます。</p>}
      {!connected && <p className="notice info">「Claude の接続」で接続方法を選ぶと次へ進めます。</p>}
      {p.audio.music?.file && p.audio.narration.enabled && <p className="notice info">音楽とナレーションの両方を使います。ナレーションの間は音楽の音量を {Math.round(p.audio.narration.musicVolume * 100)}% に下げて重ねます。</p>}
    </div>
  );
}

function FormatCard({ slug, data }: { slug: string; data: ProjectData }) {
  const [, act] = useAction(); const f = data.project.format; const hasMusic = !!data.project.audio.music?.file;
  const setFmt = (patch: Partial<typeof f>) => act(() => api.patch(slug, { format: { ...f, ...patch } }));
  return (
    <section className="card stack">
      <h2>形式</h2>
      <div className="row wrap">
        {PRESETS.map(pr => <button key={pr.label} className="btn sm" aria-pressed={f.width === pr.w && f.height === pr.h} style={f.width === pr.w && f.height === pr.h ? { borderColor: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 700 } : undefined} onClick={() => setFmt({ width: pr.w, height: pr.h })}>{pr.label}<span className="muted mono small">{pr.w}×{pr.h}</span></button>)}
      </div>
      <div className="row wrap" style={{ gap: 18 }}>
        <label className="row">幅 <input className="input num" type="number" defaultValue={f.width} key={'w' + f.width} onBlur={e => +e.target.value !== f.width && setFmt({ width: +e.target.value })} /></label>
        <label className="row">高さ <input className="input num" type="number" defaultValue={f.height} key={'h' + f.height} onBlur={e => +e.target.value !== f.height && setFmt({ height: +e.target.value })} /></label>
        <label className="row">fps
          <select className="input" style={{ width: 'auto' }} value={f.fps} onChange={e => setFmt({ fps: +e.target.value })}>{[24, 25, 30, 60].map(v => <option key={v}>{v}</option>)}</select>
        </label>
        <label className="row">長さ <input className="input num" type="number" step="0.1" disabled={hasMusic} defaultValue={f.duration} key={'d' + f.duration} onBlur={e => +e.target.value !== f.duration && setFmt({ duration: +e.target.value })} />秒</label>
        <label className="row">字幕
          <select className="input" style={{ width: 'auto' }} value={data.project.captions} onChange={e => act(() => api.patch(slug, { captions: e.target.value as never }))}>
            <option value="none">なし</option><option value="subtitle">字幕</option><option value="karaoke">カラオケ</option>
          </select>
        </label>
      </div>
      <p className="small muted">{hasMusic ? '長さは音楽に合わせて決まります。' : 'ナレーションを使う場合、音声の長さに合わせて後で自動調整できます。'} 字幕は歌詞（音楽）かナレーション文から作られます。</p>
    </section>
  );
}

function MusicCard({ slug, data }: { slug: string; data: ProjectData }) {
  const [busy, act] = useAction(); const toast = useToast();
  const m = data.project.audio.music;
  const [tempo, setTempo] = useState<Tempo | null>(null);
  const [lyrics, setLyrics] = useState('');
  const [taps, setTaps] = useState<number[]>([]);
  const click = useClickTrack(m ? fileUrl(slug, m.file) : null, m?.bpm || 0, m?.offset || 0);
  const upload = (file: File) => act(async () => { const r = await api.uploadMusic(slug, file); setTempo(r.tempo); }, '音楽を追加しました');
  const setBpm = (bpm: number, reestimate: boolean) => act(async () => {
    let offset = m!.offset;
    if (reestimate && bpm > 0) offset = (await api.tempo(slug, bpm)).offset;
    await api.patch(slug, { audio: { ...data.project.audio, music: { ...m!, bpm, offset } } });
  });
  const tap = () => {
    const now = performance.now() / 1000, arr = [...taps.filter(x => now - x < 3), now].slice(-8); setTaps(arr);
    if (arr.length >= 4) { const iv = (arr[arr.length - 1] - arr[0]) / (arr.length - 1); toast(`タップ: ${(60 / iv).toFixed(1)} BPM`); }
  };
  const tapBpm = taps.length >= 4 ? Math.round(600 * (taps.length - 1) / (taps[taps.length - 1] - taps[0])) / 10 : 0;

  return (
    <section className="card stack">
      <div className="section-title"><h2><Icon name="music" /> 音楽</h2><span className="small muted">ミュージックビデオなど、曲に合わせる場合</span></div>
      {!m ? (
        <label className="empty" style={{ cursor: 'pointer' }}>
          <span>音声ファイル（mp3 / wav / m4a）を選ぶ</span>
          <input type="file" accept="audio/*" hidden onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
          <span className="btn" aria-hidden="true">{busy ? '解析中…' : 'ファイルを選択'}</span>
        </label>
      ) : (
        <>
          <div className="row wrap">
            <b className="mono">{m.file.replace('assets/', '')}</b><span className="muted tnum">{fmtTime(m.duration)}</span>
            <span className="spacer" />
            <audio src={fileUrl(slug, m.file)} controls preload="none" style={{ height: 32 }} />
            <button className="btn sm ghost danger" onClick={() => act(() => api.removeMusic(slug), '音楽を外しました')}>外す</button>
          </div>
          <div className="row wrap" style={{ gap: 16 }}>
            <label className="row">BPM <input className="input num" type="number" step="0.1" defaultValue={m.bpm || ''} key={'b' + m.bpm} onBlur={e => +e.target.value !== m.bpm && setBpm(+e.target.value, true)} /></label>
            <label className="row">1拍目の位置 <input className="input num" type="number" step="0.01" defaultValue={m.offset} key={'o' + m.offset}
              onBlur={e => +e.target.value !== m.offset && act(() => api.patch(slug, { audio: { ...data.project.audio, music: { ...m, offset: +e.target.value } } }))} />秒</label>
            <button className="btn sm" onClick={click.toggle}><Icon name={click.on ? 'pause' : 'play'} />{click.on ? '止める' : 'クリック音を重ねて確認'}</button>
            <button className="btn sm" disabled={busy} onClick={() => act(async () => setTempo(await api.tempo(slug)))}>候補を推定</button>
            <button className="btn sm" onClick={tap} title="曲に合わせて4回以上タップ">タップで計測{tapBpm ? `（${tapBpm}）` : ''}</button>
            {tapBpm > 0 && <button className="btn sm" onClick={() => setBpm(tapBpm, true)}>{tapBpm} BPM を使う</button>}
          </div>
          {tempo?.candidates && tempo.candidates.length > 1 && (
            <div className="row wrap small"><span className="muted">推定候補:</span>
              {tempo.candidates.map(c => <button key={c.bpm} className="btn sm" onClick={() => setBpm(c.bpm, true)}>{c.bpm} BPM <span className="muted">{Math.round(c.score * 100)}%</span></button>)}
              <span className="muted">（倍・半分・3:2 の取り違えがよくあります。クリック音で確認してください）</span>
            </div>
          )}
          <label className="field"><span>歌詞・タイミング（任意）</span>
            <small>LRC 形式「[00:12.50]歌詞」か、1行ずつ「開始秒 終了秒 歌詞」。現在 {m.lyrics.length} 行。</small>
            <textarea className="input mono" rows={4} placeholder={'[00:01.50]I see sparks of AGI in your eyes\n[00:06.00]Your circuits make me nervous,'} value={lyrics} onChange={e => setLyrics(e.target.value)} />
          </label>
          <div className="row"><span className="spacer" /><button className="btn sm" disabled={!lyrics.trim() || busy} onClick={() => act(async () => { const r = await api.lyrics(slug, lyrics); toast(`${r.count} 行の歌詞を読み込みました`); setLyrics(''); })}>歌詞を読み込む</button></div>
        </>
      )}
    </section>
  );
}

// Plays the music with a click on every beat (accent on bar starts) so the user can check BPM and offset by ear.
function useClickTrack(url: string | null, bpm: number, offset: number) {
  const [on, setOn] = useState(false);
  const ref = useRef<{ audio: HTMLAudioElement; ctx: AudioContext; timer: number } | null>(null);
  const stop = () => { const r = ref.current; if (!r) return; r.audio.pause(); clearInterval(r.timer); r.ctx.close(); ref.current = null; setOn(false); };
  useEffect(() => stop, [url, bpm, offset]);
  const start = async () => {
    if (!url || !bpm) return;
    const audio = new Audio(url), ctx = new AudioContext(); await audio.play();
    const beat = 60 / bpm; let next = Math.max(0, Math.ceil((audio.currentTime - offset) / beat));
    const timer = window.setInterval(() => {
      const ahead = audio.currentTime + .15;
      while (offset + next * beat < ahead) {
        const at = ctx.currentTime + Math.max(0, offset + next * beat - audio.currentTime);
        const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = next % 4 === 0 ? 1760 : 1175;
        g.gain.setValueAtTime(.35, at); g.gain.exponentialRampToValueAtTime(.001, at + .05);
        o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + .06); next++;
      }
      if (audio.ended) stop();
    }, 40);
    ref.current = { audio, ctx, timer }; setOn(true);
  };
  return { on, toggle: () => (on ? stop() : start()) };
}

function NarrationCard({ slug, data }: { slug: string; data: ProjectData }) {
  const [busy, act] = useAction();
  const n = data.project.audio.narration;
  const [speakers, setSpeakers] = useState<{ id: number; name: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const patch = (x: Partial<typeof n>) => act(() => api.patch(slug, { audio: { ...data.project.audio, narration: { ...n, ...x } } }));
  const loadSpeakers = () => act(async () => { const r = await api.speakers(n.url); if (r.ok) { setSpeakers(r.speakers!); setErr(null); } else { setSpeakers(null); setErr(r.error!); } });
  useEffect(() => { if (n.enabled && !speakers) loadSpeakers(); }, [n.enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="card stack">
      <div className="section-title"><h2><Icon name="mic" /> ナレーション</h2><span className="small muted">解説・紹介動画など、語りを入れる場合</span></div>
      <label className="row"><input type="checkbox" checked={n.enabled} onChange={e => patch({ enabled: e.target.checked })} /> ナレーションを使う（Claude が各ショットの台本を書き、VOICEVOX で音声にします）</label>
      {n.enabled && (
        <>
          <div className="row wrap" style={{ gap: 16 }}>
            <label className="row">VOICEVOX の URL <input className="input" style={{ width: 220 }} defaultValue={n.url} onBlur={e => e.target.value !== n.url && patch({ url: e.target.value })} /></label>
            <button className="btn sm" disabled={busy} onClick={loadSpeakers}><Icon name="refresh" />接続を確認</button>
            {speakers && (
              <label className="row">話者
                <select className="input" style={{ width: 'auto' }} value={n.speaker} onChange={e => patch({ speaker: +e.target.value })}>
                  {speakers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
            <label className="row">話速 <input className="input num" type="number" step="0.05" min="0.5" max="2" defaultValue={n.speed} onBlur={e => patch({ speed: +e.target.value })} /></label>
            <label className="row">行の前後の間 <input className="input num" type="number" step="0.1" min="0" max="3" defaultValue={n.gap} onBlur={e => patch({ gap: +e.target.value })} />秒</label>
          </div>
          {err && <p className="notice warn">{err}。VOICEVOX（https://voicevox.hiroshiba.jp/）を起動してから「接続を確認」を押してください。台本づくりは VOICEVOX なしでも進められます。</p>}
          <p className="small muted">音声の合成は構成レビューの画面で行います。合成すると、音声の長さに合わせてショットの長さを調整できます。</p>
        </>
      )}
    </section>
  );
}
