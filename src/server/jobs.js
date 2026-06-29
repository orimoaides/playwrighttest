/**
 * ジョブ管理: 非同期ジョブ方式（投入 → SSE進捗 → 完成後DL）。
 *
 * フロー（scenario 編集を必ず挟む）:
 *   POST /api/jobs            → crawl → scenario → state:"awaiting_scenario"（ここで一旦停止）
 *   POST /api/jobs/:id/scenario(編集後の scenario) → capture → manual → state:"done"
 *
 * ジョブ単位で成果物を jobs/<id>/ に保存する（scenario.json / steps.json / manual.html / shots/）。
 */

import path from "node:path";
import fs from "node:fs/promises";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { crawl } from "./pipeline/crawl.js";
import { generateScenario } from "./pipeline/scenario.js";
import { capture } from "./pipeline/capture.js";
import { generateManual } from "./pipeline/manual.js";

const JOBS_ROOT = path.resolve(process.cwd(), "jobs");

/** @type {Map<string, Job>} */
const jobs = new Map();

/**
 * @typedef {Object} Job
 * @property {string} id
 * @property {string} state  queued|crawling|scenario|awaiting_scenario|capturing|manual|done|error
 * @property {object} input
 * @property {string} dir
 * @property {EventEmitter} emitter
 * @property {any[]} events    これまでの全イベント（SSE 後追い用）
 * @property {import('../shared/types.js').Routes|null} routes
 * @property {any[]} summaries
 * @property {import('../shared/types.js').Scenario|null} scenario
 * @property {import('../shared/types.js').Steps|null} steps
 * @property {string|null} error
 */

/** Playwright Browser の供給関数（server から注入） */
let getBrowser = async () => {
  throw new Error("browser provider 未設定");
};
export function setBrowserProvider(fn) {
  getBrowser = fn;
}

/**
 * 新規ジョブを作成し、フェーズ①（crawl→scenario）を非同期実行する。
 * @param {object} input { url, options }
 */
export async function createJob(input) {
  const id = randomUUID().slice(0, 8);
  const dir = path.join(JOBS_ROOT, id);
  await fs.mkdir(path.join(dir, "shots"), { recursive: true });

  /** @type {Job} */
  const job = {
    id, state: "queued", input, dir,
    emitter: new EventEmitter(), events: [],
    routes: null, summaries: [], scenario: null, steps: null, error: null,
  };
  job.emitter.setMaxListeners(50);
  jobs.set(id, job);

  // 非同期で開始（呼び出し側は即 id を受け取る）
  runCrawlAndScenario(job).catch((e) => fail(job, e));
  return job;
}

export function getJob(id) {
  return jobs.get(id);
}

/** クライアントが編集後の scenario を投入 → capture→manual を実行 */
export async function submitScenario(id, scenario) {
  const job = jobs.get(id);
  if (!job) throw new Error("ジョブが見つかりません: " + id);
  if (job.state !== "awaiting_scenario") throw new Error(`現在の状態では scenario を受け付けられません: ${job.state}`);
  job.scenario = scenario;
  await writeJson(job, "scenario.json", scenario);
  runCaptureAndManual(job).catch((e) => fail(job, e));
  return job;
}

/* ───────────────────────── 内部 ───────────────────────── */

function emit(job, ev) {
  const full = { ts: Date.now(), ...ev };
  job.events.push(full);
  job.emitter.emit("event", full);
}
function log(job, msg, level = "info") {
  emit(job, { type: "log", level, msg });
}
function setState(job, state, extra = {}) {
  job.state = state;
  emit(job, { type: "state", state, ...extra });
}
function fail(job, e) {
  job.error = e?.message || String(e);
  log(job, `エラー: ${job.error}`, "err");
  setState(job, "error", { error: job.error });
}

async function runCrawlAndScenario(job) {
  const browser = await getBrowser();
  const logger = (m, l) => log(job, m, l || "info");

  setState(job, "crawling");
  log(job, `crawl 開始: ${job.input.url}`, "start");
  const { routes, summaries } = await crawl(browser, job.input.url, job.input.options || {}, logger);
  job.routes = routes;
  job.summaries = summaries;
  await writeJson(job, "routes.json", routes);
  emit(job, { type: "routes", routes });

  setState(job, "scenario");
  log(job, "scenario 生成開始", "start");
  const scenario = await generateScenario(routes, summaries, logger);
  job.scenario = scenario;
  await writeJson(job, "scenario.draft.json", scenario);

  // ここで停止し、ユーザーの確認・編集を待つ
  setState(job, "awaiting_scenario", { scenario });
  log(job, "scenario を生成しました。内容を確認・編集して実行してください。", "ok");
}

async function runCaptureAndManual(job) {
  const browser = await getBrowser();
  const logger = (m, l) => log(job, m, l || "info");
  const shotsDir = path.join(job.dir, "shots");

  setState(job, "capturing");
  log(job, "capture 開始（実 Playwright で撮影）", "start");
  const steps = await capture(browser, job.scenario, shotsDir, logger);
  job.steps = steps;
  await writeJson(job, "steps.json", steps);
  emit(job, { type: "steps", steps });

  setState(job, "manual");
  log(job, "manual 生成開始", "start");
  const { inlineHtml, linkedHtml } = await generateManual(steps, job.dir, job.scenario.baseUrl, logger);
  await fs.writeFile(path.join(job.dir, "manual.inline.html"), inlineHtml);
  await fs.writeFile(path.join(job.dir, "manual.html"), linkedHtml);

  const errorCount = steps.steps.filter((s) => s.status === "error").length;
  setState(job, "done", {
    stepCount: steps.steps.length,
    errorCount,
    formats: ["html", "zip", "site"],
  });
  log(job, `完了: 全 ${steps.steps.length} ステップ（エラー ${errorCount} 件）`, "ok");
}

async function writeJson(job, name, obj) {
  await fs.writeFile(path.join(job.dir, name), JSON.stringify(obj, null, 2));
}
