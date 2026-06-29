/**
 * scenario(): routes ＋ 各ページの DOM 要約を Gemini に渡し、responseSchema で
 * scenario（契約[2]）を生成する。ルートが多い場合はチャンク分割して投げる。
 *
 * 生成後はユーザーがシナリオ編集画面で確認・編集できる（フロント側で実施）。
 *
 * TODO(phase3): core の scenario モジュールとして切り出す。
 */

import { callGemini } from "../gemini.js";
import { SCENARIO_SCHEMA, makeStepId } from "../../shared/types.js";

const CHUNK = 10;

/**
 * @param {import('../../shared/types.js').Routes} routes
 * @param {import('./crawl.js').PageSummary[]} summaries
 * @param {(msg:string, level?:string)=>void} [log]
 * @returns {Promise<import('../../shared/types.js').Scenario>}
 */
export async function generateScenario(routes, summaries, log = () => {}) {
  const baseUrl = routes.origin;
  const all = routes.routes;
  const byUrl = new Map((summaries || []).map((s) => [s.url, s]));
  const collected = [];

  for (let i = 0; i < all.length; i += CHUNK) {
    const slice = all.slice(i, i + CHUNK);
    const chunkNo = Math.floor(i / CHUNK) + 1;
    const chunkTotal = Math.ceil(all.length / CHUNK);
    log(`scenario 生成（チャンク ${chunkNo}/${chunkTotal}, ${slice.length}ページ）`, "start");

    // 各ページの DOM 要約（実在セレクタ）を添える
    const pages = slice.map((r) => {
      const s = byUrl.get(r.url);
      return {
        url: r.url,
        title: r.title,
        headings: s?.headings || [],
        controls: (s?.controls || []).map((c) => ({ selector: c.selector, kind: c.kind, label: c.label })),
      };
    });

    const prompt =
`あなたは熟練のQAエンジニアです。以下のサイト情報から、利用者が操作マニュアルとして知るべき「重要な画面と操作」を steps として列挙してください。

# 厳守事項
- 出力は指定スキーマのJSONのみ。自由記述・前置き・コードフェンスを一切含めない。
- 各 step の id は "step-01" のようなゼロ埋め連番。
- description は日本語で簡潔に（その画面で利用者が何を確認・操作するか）。
- url は与えられた url を使う。
- actions は操作がある場合のみ。type は click|fill|goto|wait のいずれか。無ければ空配列 []。
- selector は各ページの controls に列挙された実在セレクタを優先して使う（存在しないセレクタを発明しない）。
- fill の value はサンプル値（個人情報は使わず "<sample>" 等のダミー）。
- 破壊的操作（削除・退会・送金など）は actions に含めない。

# baseUrl
${baseUrl}

# pages（このチャンク。controls は実在する操作対象）
${JSON.stringify(pages, null, 2)}`;

    try {
      const out = await callGemini(prompt, SCENARIO_SCHEMA);
      const steps = Array.isArray(out.steps) ? out.steps : [];
      collected.push(...steps);
      log(`チャンク ${chunkNo} → ${steps.length} ステップ`, "ok");
    } catch (e) {
      log(`チャンク ${chunkNo} 失敗: ${e.message}（スキップして継続）`, "err");
    }
  }

  const steps = collected.map((s, idx) => ({
    id: makeStepId(idx),
    name: s.name || `ステップ ${idx + 1}`,
    description: s.description || "",
    url: s.url || baseUrl,
    actions: Array.isArray(s.actions) ? s.actions.filter((a) => a && a.type) : [],
  }));

  if (steps.length === 0) throw new Error("scenario の steps が0件でした。");
  return { baseUrl, steps };
}
