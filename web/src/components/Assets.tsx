// Assets.tsx: image assets (@img1, @img2, ...): the Step 1 card, insert chips for text boxes, and mention rendering.
import { Fragment, useRef, useState, type ReactNode } from 'react';
import { api, fileUrl, type Asset, type ProjectData } from '../api.ts';
import { Icon, useAction, useToast } from './ui.tsx';

const imageSize = (file: File) => new Promise<{ width: number; height: number }>(ok => {
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => { ok({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
  img.onerror = () => { ok({ width: 0, height: 0 }); URL.revokeObjectURL(url); };
  img.src = url;
});

export function AssetsCard({ slug, data }: { slug: string; data: ProjectData }) {
  const [busy, act] = useAction();
  const toast = useToast();
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const assets = data.project.assets;
  const upload = (files: FileList | File[]) => act(async () => {
    for (const f of Array.from(files)) await api.uploadAsset(slug, f, await imageSize(f));
  }, '素材を追加しました');
  const copy = (id: string) => { navigator.clipboard?.writeText(`@${id}`).then(() => toast(`@${id} をコピーしました`), () => toast(`@${id}`)); };

  return (
    <section className="card stack">
      <div className="section-title"><h2>画像素材</h2><span className="small muted">ロゴ・キャラクター・写真など。どの入力欄でも <code>@img1</code> のように書くと、その画像を指して Claude に指示できます</span></div>
      <div className={`drop ${drag ? 'over' : ''}`} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}>
        <span>ここに画像をドロップ、または</span>
        <button className="btn sm" disabled={busy} onClick={() => input.current?.click()}><Icon name="plus" />{busy ? '追加中…' : 'ファイルを選択'}</button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif" multiple hidden onChange={e => { if (e.target.files?.length) upload(e.target.files); e.target.value = ''; }} />
        <span className="small muted">png / jpg / webp / gif / svg · 透過 PNG はそのまま切り抜きとして使えます</span>
      </div>
      {assets.length > 0 && (
        <div className="asset-grid">
          {assets.map(a => (
            <div className="asset" key={a.id}>
              <div className="asset-thumb"><img src={fileUrl(slug, a.file)} alt={a.name} loading="lazy" /></div>
              <div className="row"><button className="mention" onClick={() => copy(a.id)} title="クリックでコピー">@{a.id}</button>
                <span className="small muted tnum">{a.width && a.height ? `${a.width}×${a.height}` : ''}</span><span className="spacer" />
                <button className="btn ghost sm danger" aria-label={`@${a.id} を削除`} onClick={() => act(() => api.deleteAsset(slug, a.id), '削除しました')}><Icon name="trash" /></button></div>
              <input className="input" placeholder="名前（例: 主人公のロボット）" defaultValue={a.name} key={a.id + 'n' + a.name}
                onBlur={e => e.target.value !== a.name && act(() => api.patchAsset(slug, a.id, { name: e.target.value }))} />
              <textarea className="input" rows={2} placeholder="使い方のメモ（例: 最後のショットで大きく登場。色は変えない）" defaultValue={a.description} key={a.id + 'd' + a.description}
                onBlur={e => e.target.value !== a.description && act(() => api.patchAsset(slug, a.id, { description: e.target.value }))} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Clickable chips that insert "@imgN " into the text box with the given id, at the cursor.
export function AssetChips({ slug, assets, targetId, value, onChange }: { slug: string; assets: Asset[]; targetId: string; value: string; onChange: (v: string) => void }) {
  if (!assets.length) return null;
  const insert = (id: string) => {
    const el = document.getElementById(targetId) as HTMLTextAreaElement | null;
    const pos = el ? el.selectionStart ?? value.length : value.length, end = el ? el.selectionEnd ?? pos : pos;
    const before = value.slice(0, pos), token = `${before && !/\s$/.test(before) ? ' ' : ''}@${id} `;
    onChange(before + token + value.slice(end));
    requestAnimationFrame(() => { if (el) { el.focus(); const p = pos + token.length; el.setSelectionRange(p, p); } });
  };
  return (
    <div className="row wrap asset-chips" aria-label="素材を挿入">
      <span className="small muted">素材:</span>
      {assets.map(a => (
        <button key={a.id} type="button" className="mention with-thumb" onClick={() => insert(a.id)} title={a.name || a.description || a.id}>
          <img src={fileUrl(slug, a.file)} alt="" />@{a.id}
        </button>
      ))}
    </div>
  );
}

// Render text with @imgN mentions as chips (thumbnail + id). Unknown ids stay plain text.
export function MentionText({ text, slug, assets }: { text: string; slug: string; assets: Asset[] }): ReactNode {
  if (!assets.length || !text.includes('@')) return text;
  const byId = new Map(assets.map(a => [a.id, a]));
  return text.split(/(@img\d+)/g).map((part, i) => {
    const a = part.startsWith('@') ? byId.get(part.slice(1)) : undefined;
    return a ? <span key={i} className="mention with-thumb inline" title={a.name || a.description}><img src={fileUrl(slug, a.file)} alt="" />{part}</span> : <Fragment key={i}>{part}</Fragment>;
  });
}
