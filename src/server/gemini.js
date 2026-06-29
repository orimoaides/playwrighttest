/**
 * Gemini クライアント（サーバー側）。
 * ★ API キーは必ずサーバーの環境変数 GEMINI_API_KEY から取得し、フロントには出さない。
 *   （フェーズ①はフロントから呼んでいたが、②ではサーバー隔離が重要な安全性向上点）
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** 使用モデル（環境変数で上書き可） */
export const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

/** API キーが設定されているか */
export function hasApiKey() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Gemini を JSON モードで呼び出す。responseSchema を渡すと構造を強制する。
 * @param {string} prompt
 * @param {object} [responseSchema]
 * @param {object} [opts]
 * @param {string} [opts.model]
 * @param {number} [opts.temperature]
 * @returns {Promise<any>} パース済み JSON
 */
export async function callGemini(prompt, responseSchema, opts = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY が未設定です。サーバーの環境変数に設定してください（例: GEMINI_API_KEY=... npm start）。"
    );
  }
  const model = opts.model || MODEL;
  const url = `${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      responseMimeType: "application/json",
    },
  };
  if (responseSchema) body.generationConfig.responseSchema = responseSchema;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini API ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini の応答が空です（safety / quota の可能性）");
  return JSON.parse(text);
}
