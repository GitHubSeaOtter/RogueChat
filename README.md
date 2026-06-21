# RogueChat

アスキーアートで遊ぶ、自由度の高いローグライク × LLM。
スマートフォンで操作でき、メッセージは日本語。**自由入力したコマンドの判定を毎ターン LLM（Claude）が解釈**します。

- パラメータ（HP / MP / 攻撃 / 防御 / レベル / 階層 / 金貨 / 所持品）はゲーム側で管理
- 移動・通常戦闘は決定論的に処理
- 自由入力欄に打ち込んだ任意の行動（例：「祈る」「壁を調べる」「火球を唱える」「モンスターを威嚇する」）は、現在の状態を添えて Claude に送り、結果（描写＋パラメータ増減）を適用
- **GitHub Pages のみで動く静的サイト**（ビルド不要）。APIキーは端末のブラウザに保存し、Anthropic API を直接呼び出し

## 遊ぶ

公開URL（GitHub Pages 有効化後）:

**https://githubseaotter.github.io/roguechat/**

> 初回のみ、リポジトリの **Settings → Pages → Build and deployment → Source** を **「GitHub Actions」** に設定してください。
> 以降、対象ブランチへの push で `.github/workflows/pages.yml` が自動デプロイします。

### 操作方法

- **移動**: 画面下のDパッド（8方向）/ キーボードの矢印・`hjkl`・`yubn`
- **待機**: Dパッド中央「・」/ `.`
- **隣のモンスターへ移動**: 攻撃
- **降りる**: `>` の上で「降りる」ボタン / `>` キー
- **持ち物（回復薬を使う）**: 「持ち物」ボタン / `g` キー
- **休む**: 少し回復（近くに敵がいると失敗しやすい）
- **自由入力**: 下部のテキスト欄に行動を打ち込み「実行」→ GM(LLM) が判定

### APIキー

- ⚙（設定）から Anthropic の APIキーを入力します。
- キーはこの端末の `localStorage` にのみ保存され、Anthropic API へ直接送信されます（サーバを介しません）。
- 共有端末では遊んだ後に「キーを消去」してください。
- モデルは Haiku 4.5（高速・低コスト・既定）/ Sonnet 4.6 / Opus 4.8 から選択できます。

APIキーが無くても、移動・戦闘・回復・階層移動は遊べます（自由入力コマンドのみ LLM が必要）。

## 構成

```
index.html        画面とレイアウト
css/style.css     スタイル（モバイル対応・ASCII表示）
js/dungeon.js     ダンジョン生成
js/game.js        ゲーム状態・戦闘・モンスター・視界・描画
js/llm.js         Anthropic API（構造化出力で判定を受け取る）
js/main.js        UI配線・入力・設定
.github/workflows/pages.yml  GitHub Pages 自動デプロイ
```

## ローカル確認

任意の静的サーバで配信してください（`file://` だと ES モジュールが動きません）:

```sh
python3 -m http.server 8000
# → http://localhost:8000/
```
