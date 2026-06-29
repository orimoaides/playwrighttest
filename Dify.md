# Dify 連携ガイド

このアプリ（フェーズ②）は AI 呼び出しを **Gemini** と **Dify** で切り替えられます。
本書は **Dify のチャットボットアプリを LLM バックエンドとして使う** ための手順です。

---

## 仕組み（概要）

- AI 呼び出しは `src/server/ai.js` に集約され、環境変数 `AI_PROVIDER` で実体が切り替わります。
- `AI_PROVIDER=dify` のとき、本アプリは **Dify の `POST /v1/chat-messages`** にプロンプト全文を送り、返ってきたテキストから JSON を取り出して使います。
- アプリが Dify を呼ぶのは次の2箇所です（どちらも**プロンプト全文をこちらから送る**ので、Dify 側に複雑な設定は不要）:
  1. **シナリオ生成** … ルート情報から「重要画面と操作」を JSON で出す
  2. **マニュアル説明文** … 各ステップの見出し・本文を JSON で出す

> Dify には Gemini の `responseSchema` のような厳密な構造強制がありません。
> そのため本アプリは「JSONのみ返す」指示＋頑健パース（コードフェンス除去・JSONブロック抽出）で対応します。
> Dify アプリ側は **JSON で答えやすいモデル**（GPT-4o / Claude / Gemini 等）を選ぶと安定します。

---

## 手順

### 1. Dify でチャットボットアプリを作成

1. Dify（[cloud](https://cloud.dify.ai) もしくはセルフホスト）にログイン。
2. **「アプリを作成」→「チャットボット」** を選択。
3. 名前を付けて作成（例: `manual-generator`）。

### 2. モデルを設定

1. アプリの **「オーケストレーション / プロンプト」** 画面を開く。
2. 右上で **モデルを選択**（例: `gpt-4o-mini` / `claude-3-5-sonnet` / `gemini-2.5-flash` など、JSON 出力が得意なもの）。
3. **システムプロンプト（手順/前置き）は空のままで OK。**
   本アプリが必要な指示を含むプロンプト全文を送るため、Dify 側に指示を書く必要はありません。
   - （任意）保険として `あなたは指示に厳密に従い、常に有効な JSON のみを返すアシスタントです。` だけ入れても可。
4. **変数（Variables）は不要**。本アプリは `query` に直接プロンプトを送ります。
5. 右上の **「公開」** を押して反映。

### 3. API キーを取得

1. 左メニューの **「APIアクセス」** を開く。
2. **「APIキー」→「新しいシークレットキーを作成」** で `app-...` を発行・コピー。
3. （セルフホストの場合）この画面に表示される **API ベースURL**（例 `http://localhost/v1`）も控える。

### 4. アプリ側に設定

**いちばん簡単なのは `config.js` に貼る方法です。**

```bash
cp config.example.js config.js
```

`config.js` を開いて編集:

```js
export default {
  AI_PROVIDER: "dify",
  DIFY_API_KEY: "app-xxxxxxxxxxxxxxxx",      // ← ここに貼る
  // DIFY_BASE_URL: "https://your-dify.example.com/v1", // セルフホスト時のみ
};
```

`.env` 派でも、環境変数で渡してもOK:

```bash
# .env の例（cp .env.example .env）
AI_PROVIDER=dify
DIFY_API_KEY=app-xxxxxxxxxxxxxxxx
# DIFY_BASE_URL=https://your-dify.example.com/v1   # セルフホスト時のみ

# もしくは一発で
# AI_PROVIDER=dify DIFY_API_KEY=app-xxxx npm start
```

`config.js` / `.env` は .gitignore 済み。優先順位は **環境変数 > config.js**。

### 5. 起動して確認

```bash
npm install          # 初回のみ
npm run setup        # 初回のみ（Playwright の Chromium 取得）
npm start            # .env を自動読込
# → http://localhost:5179
```

起動ログに次のように出れば OK:

```
AI: dify (https://api.dify.ai/v1/chat-messages)
DIFY_API_KEY: 設定済み
```

`.env` を使わず一発で渡す場合:

```bash
AI_PROVIDER=dify DIFY_API_KEY=app-xxxx npm start
```

---

## 環境変数まとめ

| 変数 | 必須 | 説明 |
|---|---|---|
| `AI_PROVIDER` | ○ | `dify` を指定（既定は `gemini`） |
| `DIFY_API_KEY` | ○ | Dify アプリの API キー（`app-...`） |
| `DIFY_BASE_URL` | △ | 既定 `https://api.dify.ai/v1`。セルフホスト時のみ差し替え |
| `PORT` | △ | サーバーポート（既定 5179） |

---

## 動作確認（任意・curl）

Dify アプリ単体が JSON を返せるか、先に確かめておくと切り分けが楽です。

```bash
curl -X POST "https://api.dify.ai/v1/chat-messages" \
  -H "Authorization: Bearer app-xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": {},
    "query": "次のJSONだけを返して: {\"heading\":\"テスト\",\"body\":\"本文\"}",
    "response_mode": "blocking",
    "user": "manual-generator"
  }'
```

`answer` フィールドに JSON が入っていれば連携できます。

---

## うまくいかないとき

| 症状 | 対処 |
|---|---|
| 起動時に「`DIFY_API_KEY` が未設定」 | `.env` または環境変数でキーを設定。`AI_PROVIDER=dify` も忘れずに |
| `Dify API 401` | API キーが誤り／失効。`APIアクセス` で再発行 |
| `Dify API 404` | `DIFY_BASE_URL` が誤り（末尾は `/v1`）。アプリが「公開」済みか確認 |
| `Dify 応答を JSON として解釈できませんでした` | モデルが JSON 以外を返している。① JSON が得意なモデルに変更、② システムプロンプトに「有効なJSONのみ返す」を追記、③ temperature を下げる |
| シナリオが 0 件になる | 上と同じ JSON 問題の可能性。アプリのログ（実行ログ）に Dify の生応答が出るので確認 |

---

## 補足

- 本アプリが Dify を呼ぶのは **シナリオ生成** と **マニュアル説明文** の2用途ですが、**プロンプト全文をこちらから送る**ので Dify アプリは1つで両方をまかなえます。
- Gemini に戻したいときは `AI_PROVIDER=gemini` ＋ `GEMINI_API_KEY` にするだけ。コード変更は不要です。
- 関連実装: `src/server/ai.js`（切替）, `src/server/dify.js`（Dify クライアント・JSONパース）, `src/server/gemini.js`（Gemini クライアント）。
