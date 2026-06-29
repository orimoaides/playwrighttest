/**
 * サーバー本体（Express）。
 *  - 静的フロント（src/web）を配信
 *  - 非同期ジョブ API（投入 / SSE進捗 / scenario編集投入 / 成果物DL）
 *  - 巡回・撮影・AI生成はすべてサーバー側。★ Gemini API キーはサーバー env のみ（フロントに出さない）
 *
 * 起動: GEMINI_API_KEY=... npm start
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import express from "express";
import { chromium } from "playwright";
import { createJob, getJob, submitScenario, setBrowserProvider } from "./jobs.js";
import { streamZip, streamSite } from "./result.js";
import { hasApiKey, MODEL } from "./gemini.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, "..", "web");
const PORT = process.env.PORT || 5179;

/* ── Playwright Browser を遅延シングルトンで供給 ── */
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true }).catch((e) => {
      browserPromise = null;
      throw new Error(
        `Chromium の起動に失敗しました。'npm run setup'（playwright install chromium）を実行してください。元エラー: ${e.message}`
      );
    });
  }
  return browserPromise;
}
setBrowserProvider(getBrowser);

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(WEB_DIR));

/** 稼働状況（フロントが API キー有無などを確認） */
app.get("/api/health", (req, res) => {
  res.json({ ok: true, hasApiKey: hasApiKey(), model: MODEL });
});

/** ジョブ投入 → crawl→scenario（その後 awaiting_scenario で停止） */
app.post("/api/jobs", async (req, res) => {
  try {
    const { url, options } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "有効な url を指定してください。" });
    if (!hasApiKey()) return res.status(400).json({ error: "サーバーに GEMINI_API_KEY が設定されていません。" });
    const job = await createJob({ url, options: options || {} });
    res.json({ id: job.id, state: job.state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** SSE 進捗ストリーム（接続時に過去イベントを再生 → 以降ライブ） */
app.get("/api/jobs/:id/stream", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).end();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`retry: 3000\n\n`);
  for (const ev of job.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const onEvent = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  job.emitter.on("event", onEvent);
  const ping = setInterval(() => res.write(`: ping\n\n`), 15000);
  req.on("close", () => {
    clearInterval(ping);
    job.emitter.off("event", onEvent);
  });
});

/** 現在の状態スナップショット（再読込時の復帰用） */
app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not found" });
  res.json({ id: job.id, state: job.state, scenario: job.scenario, steps: job.steps, error: job.error });
});

/** 編集後の scenario を投入 → capture→manual */
app.post("/api/jobs/:id/scenario", async (req, res) => {
  try {
    const scenario = req.body && req.body.scenario;
    if (!scenario || !Array.isArray(scenario.steps)) return res.status(400).json({ error: "scenario.steps が必要です。" });
    const job = await submitScenario(req.params.id, scenario);
    res.json({ id: job.id, state: job.state });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** プレビュー用: 画像インラインの manual.html を返す */
app.get("/api/jobs/:id/manual", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).end();
  const p = path.join(job.dir, "manual.inline.html");
  if (!fs.existsSync(p)) return res.status(404).send("まだ生成されていません。");
  res.type("html").sendFile(p);
});

/** 成果物ダウンロード: html | zip | site */
app.get("/api/jobs/:id/result", async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not found" });
  const format = String(req.query.format || "html");
  try {
    if (format === "html") {
      const p = path.join(job.dir, "manual.inline.html");
      if (!fs.existsSync(p)) return res.status(404).json({ error: "まだ生成されていません。" });
      return res.download(p, `manual-${job.id}.html`);
    }
    if (format === "zip") return streamZip(job, res);
    if (format === "site") return streamSite(job, res);
    return res.status(400).json({ error: "format は html|zip|site のいずれかです。" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  操作マニュアル自動生成ツール (Phase 2)`);
  console.log(`  ▶ http://localhost:${PORT}`);
  console.log(`  GEMINI_API_KEY: ${hasApiKey() ? "設定済み" : "未設定（生成不可。env に設定してください）"}`);
  console.log(`  model: ${MODEL}\n`);
});
