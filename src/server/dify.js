/**
 * Dify クライアント（サーバー側）。
 * Dify の「チャットボット」アプリを LLM バックエンドとして使う。
 * アプリの API キー（app-xxxx）とベースURLを env で設定する。
 *   DIFY_API_KEY   … Dify アプリの API キー（必須）
 *   DIFY_BASE_URL  … 既定 https://api.dify.ai/v1（セルフホスト時は差し替え）
 *
 * 注意: Dify では Gemini の responseSchema のような厳密な構造強制が使えないため、
 * 「JSONのみ返す」プロンプト＋頑健なパース（コードフェンス除去・JSONブロック抽出）で対応する。
 */

const BASE = (process.env.DIFY_BASE_URL || "https://api.dify.ai/v1").replace(/\/$/, "");

export function hasDifyKey() {
  return Boolean(process.env.DIFY_API_KEY);
}

export function difyInfo() {
  return { provider: "dify", endpoint: `${BASE}/chat-messages` };
}

/**
 * Dify チャットアプリにプロンプトを送り、JSON を取り出して返す。
 * @param {string} prompt
 * @param {object} [_schema] 互換のため受け取るが Dify では未使用
 * @returns {Promise<any>}
 */
export async function callDify(prompt, _schema) {
  const key = process.env.DIFY_API_KEY;
  if (!key) {
    throw new Error("DIFY_API_KEY が未設定です。Dify アプリの API キーを env に設定してください（例: AI_PROVIDER=dify DIFY_API_KEY=app-... npm start）。");
  }
  const res = await fetch(`${BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: {},
      query: prompt + "\n\n# 厳守: 出力は有効なJSONのみ。コードフェンス(```)・前置き・後置きを一切含めない。",
      response_mode: "blocking",
      user: "manual-generator",
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Dify API ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  // chat-messages は answer に本文。ワークフロー系の取り違え時も一応拾う。
  const text = data?.answer ?? data?.data?.outputs?.text ?? data?.data?.outputs?.answer ?? "";
  return parseJsonLoose(text);
}

/**
 * モデル応答から JSON を頑健に取り出す。コードフェンス除去 → 直接parse → JSONブロック抽出。
 * @param {string} text
 */
export function parseJsonLoose(text) {
  if (!text || !String(text).trim()) throw new Error("Dify の応答が空です（アプリ設定/モデルを確認してください）。");
  let t = String(text).trim();

  // ```json ... ``` のフェンスを剥がす
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  try {
    return JSON.parse(t);
  } catch {
    /* フォールバックへ */
  }
  // 最初の { … } または [ … ] ブロックを抽出して再試行
  const block = t.match(/[\{\[][\s\S]*[\}\]]/);
  if (block) {
    try {
      return JSON.parse(block[0]);
    } catch {
      /* noop */
    }
  }
  throw new Error("Dify 応答を JSON として解釈できませんでした: " + t.slice(0, 160));
}
