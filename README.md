# playwrighttest — 操作マニュアル自動生成ツール

URL（やローカルのHTML一式）を渡すと、そのサイトの **操作マニュアル(HTML)を自動生成する** ツールです。
サイトを「歩いて」操作を再現し、スクリーンショットと説明文つきのマニュアルを書き出します。

```
入力(URL / HTML / ローカル) → routes → scenario(AI) → steps(撮影) → manual(AI) → 出力(HTML)
```

このリポジトリはフェーズ制で開発しています。

| フェーズ | 形態 | 状態 | 置き場所 |
|---|---|---|---|
| ① | Gemini Canvas 版プロトタイプ（単一HTML） | ✅ 完了 | ルートの `index.html` |
| ② | ブラウザアプリ版（実 Playwright・ローカル実行） | ✅ 完了 | `src/`・`package.json` ほか |
| ③ | アプリ / MCP 版（CLI + MCP サーバー） | 予定 | — |

関連ドキュメント: [Dify.md](Dify.md)（AI を Dify に切替）／ [docs/engineer-briefing.html](docs/engineer-briefing.html)（説明スライド）／ [examples/shiftmate/](examples/shiftmate/)（デモ用 SaaS サイト）

---

## フェーズ① — Gemini Canvas 版（`index.html`）

完成品ではなく、後続フェーズが従う **データ契約(JSON 3種)を確定させた、動く骨格(walking skeleton)**。
ブラウザ（または Gemini Canvas）で `index.html` を開くだけで動きます。依存ライブラリなし・単一ファイル。

入力モードは3つ:

- **URL から取得** — 直接 fetch が CORS で失敗したら `CONFIG.CORS_PROXIES` のプロキシ経由に自動フォールバック（静的HTMLのみ）。
- **HTML を貼り付け** — オリジン＋ページHTMLを貼る。
- **ローカルから** — 手元のフォルダ（例 `dist/`）を選択。File API でユーザーが選んだファイルだけを読むため CORS 無関係で Canvas でも動く。

API キーは画面に出さず、Canvas 上ではキー注入（`CONFIG.USE_CANVAS_KEY`）、Canvas 外では `CONFIG.GEMINI_API_KEY` を使用。スクリーンショットは **ダミー**（実撮影はフェーズ②）。

---

## フェーズ② — ブラウザアプリ版（`src/`、ローカル実行）

URL を入力すると **サーバー側で実ブラウザ（Playwright）が巡回・実スクリーンショット・ログ取得** を行い、AI がシナリオと操作マニュアルを生成します。フロント（UI）とバックエンド（Node 実行エンジン）を分離し、フェーズ①のサンドボックス制約を解消した本番エンジンです。

### セットアップ & 起動

```bash
npm install                 # 依存関係（express / playwright / sharp / archiver）
npm run setup               # Playwright の Chromium を取得（初回のみ）

# ★ いちばん簡単: 設定ファイルにキーを貼る
cp config.example.js config.js   # コピーして config.js の GEMINI_API_KEY に貼る
npm start                        # → http://localhost:5179
```

### API キーの入れ方（どれか1つ）

| 方法 | やること |
|---|---|
| **① config.js（おすすめ・最も簡単）** | `cp config.example.js config.js` → `GEMINI_API_KEY` に貼る → `npm start` |
| ② .env | `cp .env.example .env` → 編集 → `npm start`（自動読込） |
| ③ 環境変数 | `GEMINI_API_KEY=AIza... npm start` |

`config.js` / `.env` は **.gitignore 済み**（キーはコミットされません）。優先順位は **環境変数 > config.js**。
API キーはサーバー側のみで扱い、フロントには出しません。ポートは `PORT`（既定 5179）。

### AI プロバイダの切り替え（Gemini ⇄ Dify）

AI 呼び出しは `src/server/ai.js` に隔離してあり、`AI_PROVIDER` で切り替えます。

| プロバイダ | 設定 | 構造化出力 |
|---|---|---|
| **Gemini**（既定） | `AI_PROVIDER=gemini` ＋ `GEMINI_API_KEY` | `responseSchema` で厳密に強制 |
| **Dify** | `AI_PROVIDER=dify` ＋ `DIFY_API_KEY` | プロンプトで JSON 指示＋頑健パース |

Dify の詳しい手順は [Dify.md](Dify.md) を参照。

### 使い方

1. 起点 URL と巡回オプション（最大深さ・最大ページ数・除外パターン）を入力し「巡回を開始」。
2. 進捗が **SSE でライブ表示**（巡回 → シナリオ生成）。
3. **シナリオの確認・編集**画面（必須ステップ）→「この内容で撮影・生成」。
4. 実 Playwright が各ステップを再生し、**操作前後ペア＋赤枠ハイライト付きの実スクショ**と**ログ**を取得。
5. **manual.html / zip / site** の3形式でダウンロード、プレビュー確認。

### アーキテクチャ

```
ブラウザ(フロント src/web) ──HTTP/SSE── サーバー(Node src/server)
  URL入力                        POST /api/jobs                （ジョブ投入）
  進捗バー/ライブログ            GET  /api/jobs/:id/stream     （SSE 進捗）
  シナリオ編集画面               POST /api/jobs/:id/scenario   （編集後を投入）
  プレビュー + DL                GET  /api/jobs/:id/result?format=html|zip|site

  パイプライン（すべてサーバー側・ジョブ単位で jobs/<id>/ に保存）:
    1. crawl()    ← Playwright（同一オリジンBFS / robots.txt尊重 / レート制御）
    2. scenario() ← AI（responseSchema で構造強制）→ ユーザー編集を必ず挟む
    3. capture()  ← Playwright（★核心: 前後スクショ / 赤枠 / ログ）
    4. manual()   ← AI（ステップ単位で説明文 → 固定テンプレ結合）
```

```
src/
  shared/types.js          データ契約(JSON3種) / responseSchema / 共通ユーティリティ
  server/
    index.js               Express: 静的配信 + API + SSE
    jobs.js                ジョブ管理（2段階: crawl→scenario→[編集]→capture→manual）
    ai.js                  AI プロバイダ抽象（gemini ⇄ dify）
    gemini.js / dify.js    各 AI クライアント（APIキーは env / config.js のみ）
    result.js              zip / site 形式の組み立て（archiver）
    pipeline/
      crawl.js / robots.js 巡回 → routes ＋ 各ページDOM要約（robots尊重）
      scenario.js          AI → scenario（チャンク分割）
      capture.js           ★実 Playwright で steps を実データ化（sharp で赤枠合成）
      manual.js            AI 説明文 → manual.html（inline / linked 2形態）
  web/                     フロント（index.html / app.js / styles.css）
test/smoke.mjs             AI無しでエンジン中核を検証するスモークテスト（node test/smoke.mjs）
```

---

## ★ データ契約 JSON 3種（全フェーズ共通契約・キー名厳守）

3フェーズが依存します。**キー名・構造を勝手に変えないこと。** 新機能は常に「既存契約への追加」とし「変更」にしない。型は `src/shared/types.js` に集約。

```jsonc
// [1] routes — 巡回結果
{ "origin": "https://example.com",
  "routes": [ { "url": "https://example.com/", "title": "トップ", "depth": 0 } ] }

// [2] scenario — AI が responseSchema で生成（type は click|fill|goto|wait）
{ "baseUrl": "https://example.com",
  "steps": [ { "id": "step-01", "name": "...", "description": "...", "url": "...",
               "actions": [ { "type": "fill", "selector": "#email", "value": "<sample>" } ] } ] }

// [3] steps — フェーズ①はダミー、②で実データに差し替え
{ "steps": [ { "id": "step-01", "name": "...", "description": "...", "url": "...", "action": "...",
               "screenshotBefore": "shots/step-01-before.png",
               "screenshotAfter": "shots/step-01-after.png",
               "highlight": { "x":0,"y":0,"width":0,"height":0 },
               "consoleLogs": [], "status": "ok" } ] }
```

---

## デモ用 SaaS サイト（`examples/shiftmate/`）

マニュアル生成の動作確認・デモ用の **本番想定の静的 SaaS サイト**（架空のシフト管理サービス）。
ランディング／ログイン／ダッシュボード／シフト作成／スタッフ管理／設定など8ページ。
Canvas の「ローカルから」モードでこのフォルダを選べば、サーバー無しで一連を試せます。詳細は [examples/shiftmate/README.md](examples/shiftmate/README.md)。

---

## フェーズ③（CLI / MCP化）に向けて

`src/server/pipeline` と `src/shared` を **フロント非依存の core** に昇格し、CLI / MCP / Web の薄いフロントを載せる構成へ。`SourceAdapter`（URL巡回 / ローカルファイル）の抽象化が③の新規ポイント。**JSON 3契約のキー名は不変**のまま、ローカルファイル入力モードを追加します。
