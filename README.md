# Agent Video Studio

Claude のエージェントと一緒に動画をつくる、ステッパー式のローカル GUI ツールです。
[JohnHeibel/PDoomVideo](https://github.com/JohnHeibel/PDoomVideo) の「シーンは時刻 t の純関数」「ヘッドレス Chrome で並列レンダリング」という仕組みを汎用化し、
ブリーフから書き出しまでを 6 つの工程に分けています。

| # | 工程 | 担当 | やること | できるもの |
|---|---|---|---|---|
| 1 | ブリーフ | あなた | Claude の接続方法、テーマ・目的・流れ・画風、画像素材、描き方、形式（解像度・fps・長さ）、音楽やナレーションを設定 | `brief.json` `project.json` `assets/` |
| 2 | 構成案 | Claude | 章とショットのタイムラインと、スタイルガイドを提案 | `storyboard.json` `style.md` |
| 3 | 構成レビュー | あなた ⇄ Claude | タイムライン上でショットにコメント・直接編集・カット位置のドラッグ。Claude が反映して返信 | 確定したストーリーボード |
| 4 | ラフ絵コンテ | Claude → あなた | 各ショットの SVG ラフと、音付きアニマティックで流れを確認。ショットごとに承認・描き直し | `drafts/*.svg` |
| 5 | 本制作 | Claude | リーダーが土台を作り、章ごとのサブエージェントが並列にコードで描く。各自レンダリングして自己チェック。実フレームのプレビューとリテイク依頼 | `studio.html` `lib/` `chapters/*.js` |
| 6 | 書き出し | 自動 | 全フレームを並列レンダリング → 音声ミックス → MP4 | `out/final.mp4` |

どの工程にも戻れます。Claude の作業の前後と手動保存のたびにプロジェクトごとの git に記録され、「履歴」からいつでも戻せます。

## 必要なもの

- Node.js 20 以上
- Google Chrome（または Chromium）。自動で見つからない場合は `CHROME_PATH` を設定
- Claude（[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk) を使います）。プロジェクトごとに Step 1 で接続方法を選びます:
  - **サブスクリプション**: この PC の [Claude Code](https://code.claude.com) のログイン（Pro / Max / Team）の枠を使います。環境変数の API キーは使いません。
  - **API キー**: 画面で入力したキー（`~/.agent-video-studio/settings.json` に保存。git には入りません）か、環境変数 `ANTHROPIC_API_KEY` で従量課金します。
  - 「接続を確認」でトークンを使わずに接続先（プラン・メールアドレス）を確認でき、各実行ログの先頭にも実際の接続先が出ます。
- ffmpeg / ffprobe: `npm install` で同梱版（ffmpeg-static）が入ります。使えない環境では `FFMPEG_PATH` / `FFPROBE_PATH` を設定
- git（履歴機能。なくても動きます）
- ナレーションを使う場合: [VOICEVOX](https://voicevox.hiroshiba.jp/)（ローカルで起動しておく）

## 使い方

```bash
npm install
npm run dev          # 開発: http://localhost:5173
# または
npm run build && npm start   # 本番ビルド: http://localhost:8787
```

Claude を呼ばずに画面の流れだけ試すときは、モックモードで起動します。

```bash
STUDIO_MOCK=1 npm run dev
```

| 環境変数 | 説明 |
|---|---|
| `STUDIO_PROJECTS_DIR` | プロジェクトの保存先（既定: `./projects`） |
| `STUDIO_MOCK=1` | Claude の代わりに簡易的なダミー出力を使う |
| `STUDIO_MAX_RENDERS` | エージェントのレンダリング確認の同時実行数（既定: 3） |
| `PORT` | サーバーのポート（既定: 8787） |
| `STUDIO_DEBUG=1` | エージェントのシステムイベントをサーバーのログに出す |
| `STUDIO_CONFIG_DIR` | API キーなどの保存先（既定: `~/.agent-video-studio`） |
| `CHROME_PATH` `FFMPEG_PATH` `FFPROBE_PATH` | 各ツールのパス |

## うまく動かないとき

- **開発モードで 502 / ECONNREFUSED が出る**: API サーバー（8787）が起動していません。`npm run dev` は API サーバーの応答を待ってから画面を起動し、起動に失敗したときは `[server]` の行にエラーを表示して止まります。その行を確認してください。
- **ポート 8787 が使用中**: 別のプロセスが使っています。止めるか、`PORT=8788 npm run dev` のように変えて起動してください（画面側のプロキシも同じ値に追従します）。
- **Chrome が見つからない**: `CHROME_PATH` に chrome の実行ファイルのパスを設定してください。

## 仕組み

```
web/        GUI（Vite + React）
server/     ローカルサーバー（Hono）。REST + SSE、Agent SDK の実行、音声処理、書き出し
  agent/    工程ごとのプロンプト、studio MCP ツール、権限ポリシー、モック
engine/     フレームランタイムとレンダラー（プロジェクトから共通で使う）
  runtime.js         VIDEO.chapter() / 時刻ヘルパー / 字幕 / renderAt()
  render.mjs         ヘッドレス Chrome で --sheet / --stills / --clip / --frames / --encode
  AGENT_GUIDE.md     制作エージェント向けの手引き（契約・ライブラリ・品質基準）
examples/
  pdoom/    元の PDoomVideo（参考実装。独立して動きます）
  hello/    ランタイムの最小サンプル
  painted-demo/  水彩キットの見本（モデルシートのテスト描画つき）
  motion-demo/   モーションキットの見本
  vector-demo/   ベクター/ちびキャラキットの見本（比率スペック、パラメータ掃引、表情モーフのアニメ）
projects/   あなたのプロジェクト（git 管理外。各フォルダが個別の git を持つ）
```

- **描き方とキット**: Step 1 で「おまかせ / 水彩・絵本 / モーショングラフィックス / 手描きスケッチ / アニメ・ベクター / 3D」を選べます。水彩は元の PDoom の描画基盤を移植した `engine/kits/painted.js`（p5.brush の水彩・インク・紙・粒子・ワイプ・文字）、平面系は `engine/kits/motion.js`（カメラ・奥行き・光・質感・パーティクル・仕上げ）を土台にします。見本は `examples/painted-demo/` と `examples/motion-demo/`。アニメ・ベクターは `engine/kits/vector.js`（曲線・入り抜き・モーフィング・セル塗り）と `engine/kits/chibi.js`（比率から生成するちびキャラのリグ）で、手順は `engine/VECTOR_GUIDE.md`、見本は `examples/vector-demo/`。
- **本制作の進め方**: リーダーがまずキャラクターのリグとモデルシート（`VIDEO.test('cast')`）、完成度の見本フレーム（`VIDEO.test('style')`）を作って見た目を固め、それから章ごとのサブエージェントに渡します。最後に品質基準（`engine/AGENT_GUIDE.md`）で全ショットを見直します。
- **画像素材**: Step 1 で画像を追加すると `@img1` `@img2` … の ID が付きます。ブリーフ・コメント・チャットのどこでも `@img1` と書けば、その画像を指して指示できます。シーンのコードでは `VIDEO.image('img1')` で使えます。
- **エンジンの約束ごと**: 各ショットは `fn(t, lt, dur, info)` で画面全体を描く純関数です。フレームは順不同・並列に描かれます。描画は Canvas2D を基本に、p5.js / p5.brush / three.js / GSAP / Rough.js をプロジェクトごとに選べます（`/vendor/` から配信され、CDN 不要）。
- **Claude の権限**: 工程ごとに書き込める場所を制限しています（例: 構成レビューでは `style.md` だけ、ラフでは `drafts/*.svg` だけ）。`storyboard.json` は検証付きの MCP ツール経由でのみ変更されます。Bash は使わせず、見た目の確認は `render_sheet` / `view_drafts` ツールが画像で返します。
- **音声**: 音楽は長さ・BPM 候補・1 拍目を自動推定し、クリック音で確認できます。歌詞は LRC か「開始 終了 歌詞」形式で読み込めます。ナレーションは VOICEVOX で合成し、音声の長さに合わせてショットを伸ばせます。音楽とナレーションは書き出し時にミックスされます。
- **モデル**: 工程ごとにモデル（既定 `claude-opus-5`）、思考量、1 回の実行の費用上限を設定できます。

エンジンだけを使う場合:

```bash
node engine/render.mjs --project=examples/hello --sheet=0.5,2.5,3.5,5.5 --cols=2
node engine/render.mjs --project=examples/hello --frames --workers=4
node engine/render.mjs --project=examples/hello --encode
```

## クレジット

- 元プロジェクト: [JohnHeibel/PDoomVideo](https://github.com/JohnHeibel/PDoomVideo)（`examples/pdoom/`、README は同フォルダ）
