# playwrighttest — 操作マニュアル自動生成ツール

URL（または貼り付けHTML）を渡すと、そのサイトの**操作マニュアル(HTML)を自動生成する**ツールです。
本リポジトリはフェーズ制で開発します。

| フェーズ | 形態 | 状態 |
|---|---|---|
| ① | Gemini Canvas 版プロトタイプ（単一HTML） | ✅ 本ブランチ `phase1/canvas-prototype` |
| ② | ブラウザアプリ版（実 Playwright で巡回・スクショ） | 予定 |
| ③ | アプリ / MCP 版（CLI + MCP サーバー） | 予定 |

---

## フェーズ①（このブランチの成果物）

完成品ではなく、後続フェーズが従う**データ契約(JSON 3種)を確定させた、動く骨格(walking skeleton)**です。

### 使い方

1. `index.html` をブラウザ（または Gemini Canvas）で開く。
2. **Gemini API キー**を用意（[Google AI Studio](https://aistudio.google.com/app/apikey) で取得）。入力欄に貼るか、コード冒頭の `CONFIG.GEMINI_API_KEY` 定数に入れておけば入力欄は空でOK（※配布・コミット時は空に戻すこと）。ダウンロード成果物にキーは含まれません。
   - 使用モデルは UI ではなくコードの `CONFIG.MODEL`（既定: `gemini-2.5-flash`）で指定します。
   - **Gemini Canvas 上で動かす場合はキー欄を空のままで OK**。Canvas はキーが空のとき実行時に自動でキーを注入します（`CONFIG.USE_CANVAS_KEY = true`）。Canvas 外でローカル単体利用する場合のみ自分のキーが必要です（`USE_CANVAS_KEY = false` にして設定）。
   - 注意: URL取得モードはブラウザ/Canvas の CORS 制約でほぼ失敗します。Canvas では「HTML を貼り付け」モードを使ってください。
3. 入力モードを選ぶ:
   - **起点URL から取得**: URL を入れる。※ブラウザの CORS 制約で取得できないサイトが多いです。失敗したら次のモードへ。
   - **HTML を貼り付け**: オリジン（例 `https://example.com`）と、対象ページの HTML を貼る。「サンプルHTMLを入れる」ボタンで動作確認できます。
4. **▶ パイプライン実行** を押す。
5. 進捗ログを確認し、完了したら **manual.html / scenario.json / steps.json** をダウンロード、プレビューを確認。

### 処理フロー

```
[入力UI: 起点URL or 貼り付けHTML]
  → extractRoutes()    : <a href> 列挙（同一オリジンのみ） → routes
  → generateScenario() : Gemini 2.5 で scenario を生成（responseSchema で構造強制）
  → runStepsMock()     : 実スクショの代わりにダミーで steps を生成（※後段で実装差し替え）
  → generateManual()   : steps をステップ単位で説明文化 → 固定HTMLテンプレに結合
  → [プレビュー表示] + [ダウンロード: manual.html / scenario.json / steps.json]
```

### 動作環境と制約（重要）

- 成果物は **Gemini Canvas 上で動く単一HTMLファイル（`index.html`）**。UI・ロジックを1ファイルに同梱。外部ビルド不要、依存ライブラリなし。
- ブラウザのサンドボックス制約により、**外部サイトの実巡回や Playwright 実行はできない**。フェーズ①では:
  - 巡回は「ユーザーが貼り付けたHTML、または同一オリジンで取得可能な範囲」だけの簡易版。
  - **スクリーンショットは取得せず、プレースホルダ（ダミー画像）で代替**。流れと型だけを通す。
- 呼べる AI は **Gemini API（`gemini-2.5-flash` 等の無料枠）**。Canvas 内から `fetch` で呼ぶ。
- API キーは UI 入力欄から受け取り、**ハードコードしない**。

---

## ★ データ契約 JSON 3種（全フェーズ共通契約・キー名厳守）

後続フェーズ②③はこの契約に依存します。**キー名・構造を勝手に変えないこと。** 新機能は常に「既存契約への追加」とし「変更」にしない。

### [1] routes
`<a href>` 列挙（同一オリジンのみ）の結果。

```json
{
  "origin": "https://example.com",
  "routes": [
    { "url": "https://example.com/", "title": "トップ", "depth": 0 }
  ]
}
```

### [2] scenario
Gemini に `responseSchema` で生成させる「重要画面と操作」。

```json
{
  "baseUrl": "https://example.com",
  "steps": [
    {
      "id": "step-01",
      "name": "トップページ表示",
      "description": "サイトの入口。主要メニューを確認する。",
      "url": "https://example.com/",
      "actions": [
        { "type": "fill",  "selector": "#email", "value": "<sample>" },
        { "type": "click", "selector": "button[type=submit]" }
      ]
    }
  ]
}
```

`actions` の `type` は `click | fill | goto | wait` を許可。空配列可。

### [3] steps
フェーズ①は画像をダミー（`placeholder://`）で埋める。フェーズ②で実データに差し替え。

```json
{
  "steps": [
    {
      "id": "step-01",
      "name": "トップページ表示",
      "description": "...",
      "url": "https://example.com/",
      "action": "ページを開いて主要メニューを確認",
      "screenshotBefore": "placeholder://before/step-01",
      "screenshotAfter": "placeholder://after/step-01",
      "highlight": null,
      "consoleLogs": [],
      "status": "ok"
    }
  ]
}
```

---

## コード構成（`index.html` 内）

- `extractRoutes(html, origin)` — `<a href>` を同一オリジンのみ列挙して `routes` を生成。
- `generateScenario(routes, apiKey, model)` — Gemini に `responseSchema` で `scenario` を構造強制生成。ルートが多い場合はチャンク分割。
- `runStepsMock(scenario)` — 実スクショの代わりにダミーで `steps` を生成。
  `// TODO(phase2): replace with real Playwright capture output` を明示。
- `generateManual(steps, apiKey, model)` — steps を**ステップ単位**で Gemini に渡し説明文化、固定 HTML テンプレに結合。画像は Base64 インライン化で単一HTML自己完結。

---

## フェーズ②（実 Playwright）で差し替えるべき箇所

- `runStepsMock()` → 実 `capture()` に差し替え（最重要）。`screenshotBefore/After` を実 `page.screenshot`、`highlight` を `locator.boundingBox()`、`consoleLogs` を `page.on('console'/'response')` の抽出ログ、`status` を実成否に。
- `extractRoutes()` の簡易列挙 → 起点URLからの**同一オリジン BFS 実巡回**（深さ・最大ページ数・除外パターン・robots.txt 尊重・レート制御）。
- `placeholderToDataUri()` のダミー画像 → 実 PNG（操作前後ペア＋赤枠ハイライト合成、`sharp` 等）。
- `fetch` でのフロント直叩き → **Gemini をサーバー側から呼ぶ**。API キーをサーバー env に隔離（フロントに出さない）。
- URL 取得の CORS 制約 → サーバー側 Playwright 取得で解消。
- 同期処理 → **非同期ジョブ方式（投入→SSE進捗→完成後DL）**、`html/zip/site` の3形式ダウンロード。
