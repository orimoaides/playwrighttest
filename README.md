# playwrighttest — 操作マニュアル自動生成ツール（フェーズ②）

URL を入力すると、**サーバー側で実ブラウザ（Playwright）が巡回・スクリーンショット・ログ取得**を行い、Gemini がシナリオと操作マニュアル（HTML）を生成します。フロント（UI）とバックエンド（Node 実行エンジン）を分離し、フェーズ①のブラウザ/Canvas サンドボックス制約（実 Playwright 不可・実スクショ不可）を解消します。

| フェーズ | 形態 | 状態 |
|---|---|---|
| ① | Gemini Canvas 版（単一HTML） | 完了（別ブランチ） |
| ② | ブラウザアプリ版（実 Playwright） | ✅ 本ブランチ `phase2/browser-app` |
| ③ | アプリ / MCP 版（CLI + MCP） | 予定 |

---

## セットアップ & 起動

```bash
npm install                 # 依存関係（express / playwright / sharp / archiver）
npm run setup               # Playwright の Chromium を取得（初回のみ）
GEMINI_API_KEY=AIza... npm start
# → http://localhost:5179 を開く
```

`.env` を置けば `npm start` が自動で読み込みます（`.env.example` を参照）。

- **API キーは必ずサーバーの環境変数**。フロントには出しません（フェーズ①より安全になる重要点）。
- ポートは `PORT`（既定 5179）で変更可能。

### AI プロバイダの切り替え（Gemini ⇄ Dify）

AI 呼び出しは `src/server/ai.js` に隔離してあり、env で切り替えます。

| プロバイダ | 設定 | 構造化出力 |
|---|---|---|
| **Gemini**（既定） | `AI_PROVIDER=gemini` ＋ `GEMINI_API_KEY`（`GEMINI_MODEL` 任意） | `responseSchema` で厳密に強制 |
| **Dify** | `AI_PROVIDER=dify` ＋ `DIFY_API_KEY`（`DIFY_BASE_URL` 任意） | プロンプトで JSON 指示＋頑健パース |

```bash
# Dify のチャットボットアプリ経由で動かす例
AI_PROVIDER=dify DIFY_API_KEY=app-xxxx npm start
```

**Dify 側の準備**: Dify で「チャットボット」アプリを1つ作り、モデルを選び、**システムプロンプトは空でOK**（本ツールがプロンプト全文を送ります）。発行された API キー（`app-...`）を `DIFY_API_KEY` に設定するだけ。セルフホスト Dify の場合は `DIFY_BASE_URL` をその `/v1` エンドポイントに。
※ Dify では Gemini の `responseSchema` のような厳密な構造強制が無いため、本ツールは「JSONのみ返す」指示＋コードフェンス除去・JSONブロック抽出で対応します。

## 使い方

1. 起点 URL と巡回オプション（最大深さ・最大ページ数・除外パターン）を入力し「巡回を開始」。
2. 進捗が **SSE でライブ表示**される（巡回 → シナリオ生成）。
3. **シナリオの確認・編集**画面が出る（必須ステップ）。不要なステップ削除や操作修正をして「この内容で撮影・生成」。
4. 実 Playwright が各ステップを再生し、**操作前後ペア＋赤枠ハイライト付きの実スクショ**と**ログ**を取得。
5. **manual.html / zip / site** の3形式でダウンロード、プレビューを確認。

---

## アーキテクチャ

```
ブラウザ(フロント src/web) ──HTTP/SSE── サーバー(Node src/server)
  URL入力                        POST /api/jobs                （ジョブ投入）
  進捗バー/ライブログ            GET  /api/jobs/:id/stream     （SSE 進捗）
  シナリオ編集画面               POST /api/jobs/:id/scenario   （編集後を投入）
  プレビュー + DL                GET  /api/jobs/:id/result?format=html|zip|site

  パイプライン（すべてサーバー側・ジョブ単位で jobs/<id>/ に保存）:
    1. crawl()    ← Playwright（同一オリジンBFS / robots.txt尊重 / レート制御）
    2. scenario() ← Gemini（responseSchema で構造強制）→ ユーザー編集を必ず挟む
    3. capture()  ← Playwright（★核心: 前後スクショ / 赤枠 / ログ）
    4. manual()   ← Gemini（ステップ単位で説明文 → 固定テンプレ結合）
```

非同期ジョブ方式（投入 → SSE進捗 → 完成後DL）。同期で待たせません。

### ディレクトリ
```
src/
  shared/types.js          データ契約(JSON3種) / responseSchema / 共通ユーティリティ（フロント・サーバー共用）
  server/
    index.js               Express: 静的配信 + API + SSE
    jobs.js                ジョブ管理（2段階: crawl→scenario→[編集]→capture→manual）
    gemini.js              Gemini クライアント（APIキーは env のみ）
    result.js              zip / site 形式の組み立て（archiver）
    pipeline/
      crawl.js             巡回 → routes ＋ 各ページDOM要約
      robots.js            robots.txt パーサ／判定
      scenario.js          Gemini → scenario（チャンク分割）
      capture.js           ★実 Playwright で steps を実データ化（sharp で赤枠合成）
      manual.js            Gemini説明文 → manual.html（inline / linked 2形態）
  web/                     フロント（index.html / app.js / styles.css）
test/smoke.mjs             Gemini無しでエンジン中核を検証するスモークテスト
```

---

## ★ データ契約 JSON 3種（全フェーズ共通・キー名厳守）

フェーズ①と**同一のキー名・構造**。型は `src/shared/types.js` に集約し、フロント／サーバー双方が参照します。フェーズ②では `steps` の `screenshotBefore/After`・`highlight`・`consoleLogs` を**ダミーから実データに差し替え済み**。

- **routes**: `{ origin, routes:[{url,title,depth}] }`
- **scenario**: `{ baseUrl, steps:[{id,name,description,url,actions:[{type,selector,value}]}] }`（type は `click|fill|goto|wait`）
- **steps**: `{ steps:[{id,name,description,url,action,screenshotBefore,screenshotAfter,highlight,consoleLogs,status}] }`
  - `screenshotBefore/After`: 実スクショの相対パス（例 `shots/step-01-before.png`）
  - `highlight`: 操作対象の `{x,y,width,height}`（赤枠合成に使用）／無ければ `null`
  - `consoleLogs`: エラー / 主要遷移のみ抽出

---

## ダウンロード3形式

| format | 内容 |
|---|---|
| `html` | 画像を Base64 インライン化した単一 `manual.html`（自己完結） |
| `zip`  | `manual.html` + `shots/` + `steps.json` + `scenario.json` + `routes.json` |
| `site` | 複数ページ分割の静的サイト（`index.html` + `step-XX.html` + `shots/`） |

---

## 検証（スモークテスト）

Gemini キー無しでもエンジン中核（crawl / capture / manual描画）を検証できます:

```bash
node test/smoke.mjs
```

ローカルに小さな静的サイトを立て、巡回 → 実スクショ（赤枠ハイライト）→ manual.html 生成まで通すアサーション付きテスト。

---

## デプロイ形態

主軸は**ローカル実行アプリ**（`npm start` で起動、ユーザーPCで完結）。認証付きサイトにも強い構成です。
Playwright 公式 Docker でのサーバー運用は将来オプション（本READMEに記載のみ）。

---

## セキュリティ / 制御

- **API キーはサーバー env のみ**（フロント非露出）。
- 巡回は**同一オリジンのみ**、`maxDepth` / `maxPages` / 除外パターンで制御、**robots.txt 尊重**＋レート制御。
- シナリオは**ユーザー確認・編集を必ず挟む**（破壊的操作はプロンプトで抑止）。

---

## フェーズ③（CLI / MCP化）で core として切り出すべきモジュール一覧

フェーズ③では `src/server/pipeline` と `src/shared` を**フロント非依存の `packages/core`** へ昇格させ、その上に CLI / MCP / Web の薄いフロントを載せます。切り出し対象:

- `src/shared/types.js` → `packages/core/types`（データ契約・responseSchema・共通ユーティリティ）
- `src/server/gemini.js` → `packages/core`（Gemini クライアント）
- `src/server/pipeline/crawl.js` + `robots.js` → `packages/core`（`UrlCrawlAdapter` の実体。`SourceAdapter` インターフェース化）
- `src/server/pipeline/scenario.js` → `packages/core`
- `src/server/pipeline/capture.js` → `packages/core`（★ Playwright ランナー。`SourceAdapter` 非依存に）
- `src/server/pipeline/manual.js` → `packages/core`
- `src/server/result.js` → `packages/core`（html / zip / site ビルダー）
- `src/server/jobs.js` のパイプライン進行ロジック → `packages/core` の `runPipeline()` 相当へ（ジョブ/SSE は Web フロント固有として残す）

新規に必要なのは「`SourceAdapter`（`UrlCrawlAdapter` / `LocalFileAdapter`）の抽象化」「CLI 引数 → core 呼び出し」「MCP tool → core 呼び出し」。**JSON 3契約のキー名は不変**のまま、ローカルファイル入力モードを追加します。
