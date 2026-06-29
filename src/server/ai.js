/**
 * AI プロバイダ抽象化レイヤー。
 * パイプライン（scenario / manual）はこの callAI() だけを呼び、実体は env で切り替わる。
 *
 *   AI_PROVIDER=gemini （既定） … Google Gemini API を直接呼ぶ（responseSchema で構造強制）
 *   AI_PROVIDER=dify              … Dify のチャットボットアプリ経由（JSONをパース）
 *
 * TODO(phase3): core の AI クライアントとして切り出す。
 */

import { callGemini, hasApiKey as hasGeminiKey, MODEL as GEMINI_MODEL } from "./gemini.js";
import { callDify, hasDifyKey, difyInfo } from "./dify.js";

export const AI_PROVIDER = (process.env.AI_PROVIDER || "gemini").toLowerCase();

/** AI が利用可能か（キー設定済みか） */
export function aiReady() {
  return AI_PROVIDER === "dify" ? hasDifyKey() : hasGeminiKey();
}

/** フロント/ログ表示用の情報 */
export function aiInfo() {
  if (AI_PROVIDER === "dify") {
    const d = difyInfo();
    return { provider: "dify", detail: d.endpoint, ready: hasDifyKey(), keyEnv: "DIFY_API_KEY" };
  }
  return { provider: "gemini", detail: GEMINI_MODEL, ready: hasGeminiKey(), keyEnv: "GEMINI_API_KEY" };
}

/**
 * プロンプトを送り、パース済み JSON を返す（プロバイダ非依存）。
 * @param {string} prompt
 * @param {object} [schema] Gemini のときのみ responseSchema として使用。Dify では無視。
 * @returns {Promise<any>}
 */
export async function callAI(prompt, schema, opts) {
  if (AI_PROVIDER === "dify") return callDify(prompt, schema);
  return callGemini(prompt, schema, opts);
}
