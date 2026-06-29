/**
 * manual(): steps をステップ単位で Gemini に渡して説明文を生成し、固定 HTML テンプレに結合する。
 * 説明文の生成は1回だけ行い、そこから2形態をレンダリングする:
 *   - inlineHtml : 画像を Base64 インライン化した自己完結 manual.html（?format=html / プレビュー用）
 *   - linkedHtml : 画像を ./shots/ 参照にした manual.html（zip / site 用）
 *
 * TODO(phase3): core の manual モジュールとして切り出す。
 */

import path from "node:path";
import fs from "node:fs/promises";
import { callAI } from "../ai.js";
import { MANUAL_STEP_SCHEMA } from "../../shared/types.js";

/**
 * @param {import('../../shared/types.js').Steps} stepsContract
 * @param {string} jobDir
 * @param {string} baseUrl
 * @param {(msg:string, level?:string)=>void} [log]
 * @returns {Promise<{inlineHtml: string, linkedHtml: string}>}
 */
export async function generateManual(stepsContract, jobDir, baseUrl, log = () => {}) {
  const steps = stepsContract.steps;

  // 1) 説明文をステップ単位で生成（1回だけ）
  const docs = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    log(`manual 説明文 生成 (${i + 1}/${steps.length}) ${s.id}`, "start");
    let heading = s.name;
    let body = s.description || "";
    try {
      const prompt =
`あなたはテクニカルライターです。次の1ステップについて、操作マニュアルに載せる日本語の説明を作成してください。

# 出力スキーマ（JSONのみ。前置き禁止）
- heading: 短い見出し（名詞句、20文字以内目安）
- body: 利用者向けの手順説明（2〜4文。「何をする画面か」「どう操作するか」「確認ポイント」を平易に）

# ステップ情報
name: ${s.name}
url: ${s.url}
想定操作: ${s.action}
補足: ${s.description}`;
      const o = await callAI(prompt, MANUAL_STEP_SCHEMA);
      heading = o.heading || heading;
      body = o.body || body;
      log(`${s.id} 説明文 OK`, "ok");
    } catch (e) {
      log(`${s.id} 説明文の生成に失敗: ${e.message}（description で代替）`, "warn");
    }
    docs.push({ heading, body });
  }

  // 2) Base64 を1回だけ読み込み、2形態をレンダリング
  const inlineSrc = [];
  for (const s of steps) {
    inlineSrc.push({
      before: await toDataUri(jobDir, s.screenshotBefore),
      after: await toDataUri(jobDir, s.screenshotAfter),
    });
  }

  const inlineHtml = render(steps, docs, baseUrl, (i, which) => inlineSrc[i][which]);
  const linkedHtml = render(steps, docs, baseUrl, (i, which) =>
    which === "before" ? steps[i].screenshotBefore : steps[i].screenshotAfter
  );
  return { inlineHtml, linkedHtml };
}

/**
 * @param {import('../../shared/types.js').StepResult[]} steps
 * @param {{heading:string,body:string}[]} docs
 * @param {(i:number, which:"before"|"after")=>string} src
 */
function render(steps, docs, baseUrl, src) {
  const sections = steps.map((s, i) => {
    const { heading, body } = docs[i];
    const statusBadge =
      s.status === "ok" ? '<span class="badge ok">OK</span>' : `<span class="badge err">${esc(s.status)}</span>`;
    const logsHtml =
      s.consoleLogs && s.consoleLogs.length
        ? `<details class="logs"><summary>コンソール / ネットワーク ログ (${s.consoleLogs.length})</summary><pre>${esc(s.consoleLogs.join("\n"))}</pre></details>`
        : "";
    return `<section class="step">
  <div class="step-head"><span class="num">${i + 1}</span><h2>${esc(heading)}</h2>${statusBadge}</div>
  <p class="url"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a></p>
  <p class="body">${esc(body)}</p>
  <p class="action"><strong>操作:</strong> ${esc(s.action)}</p>
  <div class="shots">
    <figure><img src="${src(i, "before")}" alt="${esc(s.name)} 操作前"/><figcaption>操作前${s.highlight ? "（赤枠=操作対象）" : ""}</figcaption></figure>
    <figure><img src="${src(i, "after")}" alt="${esc(s.name)} 操作後"/><figcaption>操作後</figcaption></figure>
  </div>
  ${logsHtml}
</section>`;
  });
  return wrapHtml(baseUrl, steps.length, sections.join("\n"));
}

async function toDataUri(jobDir, rel) {
  try {
    const buf = await fs.readFile(path.join(jobDir, rel));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#eee"/></svg>').toString("base64");
  }
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function wrapHtml(baseUrl, count, body) {
  const generatedAt = new Date().toLocaleString("ja-JP");
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>操作マニュアル — ${esc(baseUrl)}</title>
<style>
  body{font-family:"Hiragino Sans","Noto Sans JP",system-ui,sans-serif;line-height:1.8;color:#20201d;background:#f5f3ed;margin:0}
  .doc{max-width:900px;margin:0 auto;padding:40px 22px 80px}
  header.doc-head{border-bottom:2px solid #0f7268;padding-bottom:18px;margin-bottom:26px}
  header.doc-head h1{margin:0 0 6px;font-size:25px}
  header.doc-head .meta{color:#6c675d;font-size:13px}
  .step{background:#fff;border:1px solid #e3dfd4;border-radius:12px;padding:22px;margin:0 0 18px}
  .step-head{display:flex;align-items:center;gap:12px}
  .step-head h2{margin:0;font-size:18px;flex:1}
  .num{background:#0f7268;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex:none}
  .badge{font-size:11px;padding:2px 9px;border-radius:999px;font-weight:700}
  .badge.ok{background:#e6f0ee;color:#0b574f}.badge.err{background:#f7e3df;color:#bb4f3e}
  .url{margin:8px 0 4px;font-size:13px}.url a{color:#0b574f;word-break:break-all}
  .body{margin:8px 0}
  .action{margin:8px 0;font-size:14px;color:#4a463d;background:#efece3;padding:8px 12px;border-radius:8px}
  .shots{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
  @media(max-width:620px){.shots{grid-template-columns:1fr}}
  figure{margin:0}figure img{width:100%;border:1px solid #e3dfd4;border-radius:8px;display:block}
  figcaption{font-size:12px;color:#6c675d;text-align:center;margin-top:4px}
  details.logs{margin-top:10px}details.logs pre{background:#2a2825;color:#f5f3ed;padding:10px;border-radius:8px;overflow:auto;font-size:12px}
  footer.doc-foot{color:#9a958a;font-size:12px;text-align:center;margin-top:32px}
</style></head>
<body><div class="doc">
<header class="doc-head"><h1>操作マニュアル</h1>
<div class="meta">対象: ${esc(baseUrl) || "(未設定)"} ／ 生成: ${esc(generatedAt)} ／ 全 ${count} ステップ<br>
フェーズ②: 実 Playwright による実スクリーンショット（操作前後ペア・赤枠ハイライト付き）。</div></header>
${body}
<footer class="doc-foot">Generated by 操作マニュアル自動生成ツール — Phase 2</footer>
</div></body></html>`;
}
