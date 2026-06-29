/**
 * スモークテスト: Gemini を使わずにサーバー側エンジンの中核を検証する。
 *   crawl()（実Playwright巡回＋DOM要約）→ capture()（実スクショ＋赤枠＋ログ）
 *   → generateManual()（説明文はGemini無しでdescriptionにフォールバック）→ zip/site 生成。
 * ローカルに小さな静的サイトを立てて実行する。
 *
 * 実行: node test/smoke.mjs
 */
import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { crawl } from "../src/server/pipeline/crawl.js";
import { capture } from "../src/server/pipeline/capture.js";
import { generateManual } from "../src/server/pipeline/manual.js";
import { makeStepId } from "../src/shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = (m, l = "info") => console.log(`  [${l}] ${m}`);
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error(`  ✗ FAIL: ${msg}`); } else console.log(`  ✓ ${msg}`); };

const PAGES = {
  "/": `<!DOCTYPE html><html><head><title>ホーム</title></head><body>
    <h1>ようこそ</h1><nav><a href="/">ホーム</a> <a href="/login">ログイン</a> <a href="/about">会社概要</a></nav></body></html>`,
  "/login": `<!DOCTYPE html><html><head><title>ログイン</title></head><body>
    <h1>ログイン</h1><form><input id="email" type="email" placeholder="メール"/><input id="password" type="password"/>
    <button type="submit">送信</button></form><a href="/">戻る</a></body></html>`,
  "/about": `<!DOCTYPE html><html><head><title>会社概要</title></head><body><h1>会社概要</h1><p>テスト</p><a href="/">戻る</a></body></html>`,
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const body = PAGES[u.pathname];
  if (body == null) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
});

async function main() {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const jobDir = path.join(__dirname, "..", "jobs", "_smoke");
  await fs.rm(jobDir, { recursive: true, force: true });
  await fs.mkdir(path.join(jobDir, "shots"), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    console.log("\n[1] crawl()");
    const { routes, summaries } = await crawl(browser, base + "/", { maxDepth: 2, maxPages: 10, waitMs: 0, respectRobots: false }, log);
    assert(routes.routes.length === 3, `routes 3件 (実際: ${routes.routes.length})`);
    assert(routes.origin === base, `origin 一致 (${routes.origin})`);
    const loginSummary = summaries.find((s) => s.url.endsWith("/login"));
    assert(loginSummary && loginSummary.controls.some((c) => c.selector === "#email"), "login の DOM要約に #email セレクタが含まれる");

    console.log("\n[2] capture()  ※手組みの scenario（fill+click）で実スクショ");
    const scenario = {
      baseUrl: base,
      steps: [
        { id: makeStepId(0), name: "トップページ", description: "入口", url: base + "/", actions: [] },
        { id: makeStepId(1), name: "ログイン", description: "メール入力して送信", url: base + "/login",
          actions: [{ type: "fill", selector: "#email", value: "<sample>" }, { type: "click", selector: "button[type=submit]" }] },
      ],
    };
    const steps = await capture(browser, scenario, path.join(jobDir, "shots"), log);
    assert(steps.steps.length === 2, "steps 2件");
    assert(steps.steps[0].status === "ok" && steps.steps[1].status === "ok", "両ステップ status ok");
    assert(steps.steps[1].highlight && steps.steps[1].highlight.width > 0, "step-02 に highlight（操作対象 boundingBox）");
    for (const s of steps.steps) {
      const b = await fs.stat(path.join(jobDir, s.screenshotBefore)).catch(() => null);
      const a = await fs.stat(path.join(jobDir, s.screenshotAfter)).catch(() => null);
      assert(b && b.size > 0, `${s.id} before スクショ生成 (${b ? b.size : 0}B)`);
      assert(a && a.size > 0, `${s.id} after スクショ生成 (${a ? a.size : 0}B)`);
    }
    await fs.writeFile(path.join(jobDir, "steps.json"), JSON.stringify(steps, null, 2));
    await fs.writeFile(path.join(jobDir, "scenario.json"), JSON.stringify(scenario, null, 2));
    await fs.writeFile(path.join(jobDir, "routes.json"), JSON.stringify(routes, null, 2));

    console.log("\n[3] generateManual()  ※Geminiキー無し→descriptionにフォールバック");
    const { inlineHtml, linkedHtml } = await generateManual(steps, jobDir, base, log);
    assert(inlineHtml.includes("data:image/png;base64,"), "inline版に Base64 画像が埋め込まれている");
    assert(linkedHtml.includes('src="shots/'), "linked版は shots/ 参照");
    assert(inlineHtml.includes("操作マニュアル"), "manual.html にタイトル");
    await fs.writeFile(path.join(jobDir, "manual.inline.html"), inlineHtml);
    await fs.writeFile(path.join(jobDir, "manual.html"), linkedHtml);

    console.log(`\n結果: ${failures === 0 ? "全PASS ✓" : failures + " 件 FAIL ✗"}`);
    console.log(`成果物: ${jobDir}`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
