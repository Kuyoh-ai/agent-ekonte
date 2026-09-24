# コードで描くベクターイラストの技法（曲線・入り抜き・モーフィング・仕上げ・リグ）

対象: Canvas2D（headless Chrome）で各フレームが時刻 t の純関数として描かれるキャラクター描画。
凡例 【検証済】= Node で実行確認した自作/導出コード、【出典引用】= 出典コードをほぼ転記、【導出・未実行】= 式から導いたが未実行。
`engine/kits/vector.js` はこの調査の 1〜6 を実装している。

## 1. 点列を通る滑らかな曲線（Catmull-Rom → 3次ベジェ）
Catmull-Rom は各点の接線を `(P[i+1]-P[i-1])/2` で決める補間スプライン。Hermite→Bezier 変換を代入すると **制御点は隣接点の差の 1/6**。
```
C1 = P1 + (P2 - P0)/6 ,  C2 = P2 - (P3 - P1)/6
```
- d3-shape `curveCardinal` は `k = (1 - tension)/6`。splinejs は `tension/6`（tension=1 が Catmull-Rom）。閉ループはインデックスを mod n。
- **求心（centripetal, α=0.5）変種**: 点間隔が不均一だと uniform CR はカスプや自己交差を起こす。d3 の `curveCatmullRom.alpha(0.5)` は非一様パラメータ化を制御点に焼き込む。髪の房や目の輪郭のように点間隔がバラつく形状には α=0.5 を推奨。
- **中点 2 次ベジェのトリック**: 隣接点の中点を端点、元の点を制御点にして `quadraticCurveTo` を連ねる。点を通過しないが平滑化として定番（perfect-freehand の `getSvgPathFromStroke` もこれ）。

## 2. 入り抜き（可変幅ストローク）
Canvas の lineWidth は 1 ストローク内で変えられないので、**中心線 → 法線方向に ±w(s)/2 オフセット → 左辺 + 右辺(逆順) を閉じて fill**。
- 幅プロファイル例: `iriNuki(s) = w * sin(π s)^0.7`（両端が尖る筆線）、`brush(s) = 1 + 3 * min(1, s/0.15) * min(1, (1-s)/0.4)`（入り短く抜き長い）。
- キャップ: 幅 0 なら自然に尖る。丸キャップは端点で法線を π 回転させた点列を挿入。
- 鋭角での自己交差: (1) non-zero fill で小ループは埋まる、(2) perfect-freehand 方式: 前後ベクトルの内積 < 0 をコーナー判定しオフセットを付けず弧点を挿入、(3) 近接点のスキップ、(4) 幅を曲率半径で clamp `w = min(w, 2ρ)`。
- **perfect-freehand**（Steve Ruiz）: `getStroke(points, {size, thinning, smoothing, streamline, simulatePressure, easing, start/end taper})`。半径 = `size * easing(0.5 - thinning * (0.5 - pressure))`。決定論的に使うには `simulatePressure:false, streamline:0` で固定 pressure 配列を渡す。

## 3. 形状モーフィング
### 3.1 リング再サンプル + 開始点回転 + lerp（flubber 方式）
1. パス → 点列、閉点除去、`maxSegmentLength` で中点挿入。**符号付き面積で向きを統一**（揃えないと裏返って潰れる）。
2. 点数の少ない方に等間隔で点を追加して揃える。
3. 全オフセット o について `Σ |A[(o+i)%n] - B[i]|²` 最小の o で回転。
4. 各点を lerp。
毎フレーム bestOffset は O(n²) なので **ペアごとに一度計算してキャッシュ**。出力点列は §1 で滑らかに描く（32〜64 点で目・口には十分）。

### 3.2 同一コマンド構造のベジェ制御点補間（SVG/Lottie/Rive 流）
同じコマンド列・同じ頂点数なら **アンカーと制御点をそのまま lerp**。再サンプルより形が崩れず、目や口のような「デザインされた形」に最適。Lottie の Path shape は `{v, i, o, c}` をキーフレーム間で要素ごとに補間（頂点数は全キーで同じ）。GSAP MorphSVG は `shapeIndex` で開始点対応、`type:"rotational"` で角度/長さ補間。
**推奨データ形式**: 各表情を「同じ頂点数の点列」で書き、点だけ lerp してから §1 で制御点生成（最も簡単）。

### 3.3 目と口のコツ
- **目の開閉は「上まぶた曲線を下まぶたに向かって lerp」**: 上弧 U、下弧 D（各 n 点、端点共有）、開度 o で `U' = D + (U - D) * o`。笑い目は閉を上凸の弧 H にして `U' = lerp(H, U, o)`, `D' = lerp(H, D, o)`。
- Live2D は「まばたき」を開閉パラメータへの乗算係数として扱う → `open = expressionOpen * blink(t)` で表情と瞬きが干渉しない。
- 瞬き曲線: 100〜400ms、平均 250ms。閉じは速く開きは遅く（`easeInQuad` で閉じ 35%、`easeOutCubic` で開き 65%）。周期を素数っぽい値に。
- 口のビゼーム: Rhubarb の A(閉)/B(歯を見せ少し開)/C(開)/D(大開)/E(やや丸)/F(すぼめ)/G/H/X。日本語アニメは「閉/半開/開 + う」の 4 形で十分。口内（歯・舌）は口形状で clip。

### 3.4 複数形状
flubber `separate/combine` は earcut で三角分割してピース分け。通常は**部品ごとに独立にモーフ**し、出現/消滅は alpha か縮退で処理する方が簡単。

## 4. ベジェ・ユーティリティ
- 点: `B(t) = u³P0 + 3u²tP1 + 3ut²P2 + t³P3`、微分: `3u²(P1-P0) + 6ut(P2-P1) + 3t²(P3-P2)`、法線 `(-dy, dx)` を正規化。
- 分割: de Casteljau。弧長: 16〜32 分割の折れ線和で十分（厳密は Legendre-Gauss 20 点）。弧長→t は累積テーブルの二分探索（等速で「線が伸びる」演出に必須）。
- オフセット曲線はベジェにならない（Tiller & Hanson 1984）。実用はサンプル + 法線オフセット。曲率半径 < オフセット量でカスプ。
- 内外判定: `ctx.isPointInPath(path2d, x, y)`（座標は CTM 非依存）。

## 5. Canvas2D の仕上げ
```js
// 影を下地形状でクリップ（save/restore 必須）
ctx.save(); ctx.clip(facePath); ctx.globalCompositeOperation = 'multiply'; ctx.fill(shadowPath); ctx.restore();
// source-atop: 既に描かれた不透明部分の内側にだけ塗る（部品単位のオフスクリーンで）
// 虹彩: 放射グラデーション → 上半分を multiply で暗く → ハイライトは白を source-over
// ステッカー / 外周だけの輪郭: 先に太い stroke（lineJoin/lineCap round）で全パーツ → その上に通常描画
```
- `shadowBlur` は非常に高コスト。動かない影はオフスクリーンにキャッシュ、動くならぼかしなしの 2 段影で代替。
- 部品は `new Path2D(d)` を 1 回作って再利用、モーフする部品だけ毎フレーム生成。

## 6. コードによる 2D リギング（t の純関数）
- 階層変換: `translate(pivot) → rotate → scale → translate(-pivot)` を save/restore で入れ子。頭の中で目・口・髪を描けば傾きが伝播。
- スカッシュ&ストレッチ: 2D は面積保存で `sx = 1/sy`。
- アイドル: `y = A sin(2π f t)`（f ≈ 0.25〜0.4Hz）、`sy = 1 + 0.02 sin`, `sx = 1/sy`。位相をずらした低周波を足す。
- **フォロースルー（髪・耳・リボン）** を純関数で:
  1. 正弦駆動の定常応答: 親 `sin(ωt)` に対し、ゲイン `G = 1/√((1-r²)² + (2ζr)²)`、位相遅れ `φ = atan2(2ζr, 1-r²)`、`r = ω/ω0`。簡略版: `child(t) = k * parent(t - lag)` で lag を房ごとに 0.05〜0.15 s ずつ増やし、先端ほど振幅を大きく。
  2. 減衰ばねの閉形式（wobble ライブラリ）: under-damped `x = env*(x0 cos(ω1 t) + (v0 + ζω0 x0)/ω1 sin(ω1 t))`, `env = exp(-ζω0 t)`, `ω1 = ω0√(1-ζ²)`。親のキーフレーム差分 Δk を step とみなし `child(t) = parent(t) − Σ Δk · springResponse(t − tk)` と重ね合わせれば、状態を持たずに任意の親モーションに追従する。髪は ω0 ≈ 6〜12 rad/s、ζ ≈ 0.3〜0.5。
- 房の変形: 中心線に根元 0 → 先端 1 の重み `s²` を掛けて横変位、再ベジェ化してテーパー描画。

## 7. SVG をデータとして扱う
- `new Path2D(d)` は SVG パス文字列を直接受理。`fill/stroke/clip/isPointInPath` 全部 Path2D 対応。
- 弧長サンプル: `SVGGeometryElement.getPointAtLength`（オフスクリーン `<svg>` でも Chrome では動く）。DOM 非依存なら svg-path-properties。
- 簡易パーサ（M/L/C/Z 絶対座標）で全セグメントを cubic に正規化すれば、同構造の制御点 lerp にそのまま流せる。

## 8. 参考プロジェクト
- faces.js (zengm-games): 顔を特徴ごとの SVG スニペットの合成で描き、顔 = 小さな JS オブジェクト。部品を「同じ座標系の SVG 断片 + 配置パラメータ」で持つ設計。
- perfect-freehand（§2）、flubber / KUTE.js svgMorph（§3）、Lottie（v/i/o/c キーフレーム）、Rive（Key All Vertices）、Live2D（開閉 × まばたき係数、振り子物理）、Rhubarb Lip Sync（ビゼーム）、d3-shape curve 群、epistemex/cardinal-spline-js。

## 実装上の推奨まとめ
1. 形状データは「点列（Catmull-Rom 用）」に統一。モーフは点 lerp のみ。
2. 目は「上まぶた → 下まぶた（または笑い弧）」の lerp、口は同頂点数リングの alignAndLerp（offset はキャッシュ）。
3. 線はテーパーポリゴンの fill。
4. 影・ツヤは clip + multiply/screen。輪郭は太い round stroke → fill の順。shadowBlur は毎フレーム使わない。
5. 二次動作は followSin / springResponse で t の純関数のまま。

## Sources
- https://github.com/steveruizok/perfect-freehand — getStroke のオプション、getSvgPathFromStroke
- https://github.com/veltman/flubber — interpolate/separate/combine、rotate.js / add.js / normalize.js
- https://github.com/d3/d3-shape (src/curve/catmullRom.js, cardinal.js) — α 付き Catmull-Rom、cardinal
- https://github.com/georgedoescode/splinejs — Catmull-Rom → SVG C 文字列
- https://github.com/ariutta/catmullrom2bezier — 行列形式
- https://github.com/epistemex/cardinal-spline-js — Hermite 係数と tension
- https://github.com/rveciana/svg-path-properties — DOM 非依存 getPointAtLength、Legendre-Gauss 弧長
- MDN: globalCompositeOperation / clip / isPointInPath / shadowBlur / lineJoin / Path2D / getPointAtLength
- https://github.com/skevy/wobble — 減衰ばねの閉形式
- https://github.com/LottieFiles/lottie-docs — Path shape の v/i/o/c
- https://github.com/DanielSWolf/rhubarb-lip-sync — ビゼーム A〜H, X
- https://github.com/zengm-games/facesjs — SVG 部品合成による顔生成
- https://raphlinus.github.io/curves/2022/09/09/parallel-beziers.html — オフセット曲線
- https://docs.live2d.com/en/cubism-editor-manual/eye-blink-settings/ — まばたき = 乗算係数
