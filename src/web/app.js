"use strict";
/* フロント: ジョブ投入 → SSE進捗 → シナリオ編集 → 成果物DL。
 * ★ API キーは扱わない（サーバー側のみ）。 */

const $ = (id) => document.getElementById(id);
const STAGES = ["crawling", "scenario", "awaiting_scenario", "capturing", "manual"];
let currentJobId = null;
let es = null; // EventSource
let generatedScenario = null;

/* ---- ログ・進捗表示 ---- */
const logEl = $("log");
let logCleared = false;
function log(msg, level = "info") {
  if (!logCleared) { logEl.innerHTML = ""; logCleared = true; }
  const cls = { start: "l-start", ok: "l-ok", warn: "l-warn", err: "l-err" }[level] || "l-muted";
  const div = document.createElement("div");
  div.className = cls;
  const t = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  div.textContent = `[${t}] ${msg}`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}
function setStatus(text, mode) {
  $("statusText").textContent = text;
  const s = $("status"); s.classList.remove("running", "done", "error");
  if (mode) s.classList.add(mode);
}
function stageNode(stage) { return document.querySelector(`.snode[data-stage="${stage}"]`); }
function markStages(activeState) {
  // 現在状態までを done、現在を active に
  const order = { queued: -1, crawling: 0, scenario: 1, awaiting_scenario: 2, capturing: 3, manual: 4, done: 5, error: -2 };
  const idx = order[activeState];
  STAGES.forEach((st, i) => {
    const el = stageNode(st); if (!el) return;
    el.classList.remove("is-active", "is-done", "is-error");
    if (activeState === "error") return;
    if (activeState === "done" || i < idx) el.classList.add("is-done");
    else if (i === idx) el.classList.add("is-active");
  });
}

/* ---- ジョブ開始 ---- */
async function startJob() {
  const url = $("url").value.trim();
  if (!/^https?:\/\//i.test(url)) { setStatus("有効な URL を入力してください。", "error"); return; }
  resetUi();
  $("runBtn").disabled = true;
  setStatus("ジョブを投入しています…", "running");

  const options = {
    maxDepth: Number($("maxDepth").value) || 2,
    maxPages: Number($("maxPages").value) || 12,
    excludePatterns: $("exclude").value.split(",").map((s) => s.trim()).filter(Boolean),
  };

  try {
    const res = await fetch("/api/jobs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, options }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "投入に失敗しました。");
    currentJobId = data.id;
    log(`ジョブ投入: ${currentJobId}`, "ok");
    connectStream(currentJobId);
  } catch (e) {
    setStatus("エラー: " + e.message, "error");
    log(e.message, "err");
    $("runBtn").disabled = false;
  }
}

/* ---- SSE 受信 ---- */
function connectStream(id) {
  if (es) es.close();
  es = new EventSource(`/api/jobs/${id}/stream`);
  es.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    handleEvent(m);
  };
  es.onerror = () => { /* 自動再接続に任せる */ };
}

function handleEvent(m) {
  if (m.type === "log") {
    log(m.msg, m.level);
  } else if (m.type === "state") {
    onState(m);
  }
}

function onState(m) {
  markStages(m.state);
  if (m.state === "crawling") setStatus("巡回しています（実ブラウザ）…", "running");
  else if (m.state === "scenario") setStatus("Gemini がシナリオを生成しています…", "running");
  else if (m.state === "awaiting_scenario") {
    setStatus("シナリオを確認・編集してください。", null);
    generatedScenario = m.scenario;
    showScenarioEditor(m.scenario);
  } else if (m.state === "capturing") setStatus("実 Playwright で撮影しています…", "running");
  else if (m.state === "manual") setStatus("マニュアルを生成しています…", "running");
  else if (m.state === "done") {
    setStatus(`完了しました（全 ${m.stepCount} ステップ／エラー ${m.errorCount} 件）。`, "done");
    showResult(m);
    $("runBtn").disabled = false;
  } else if (m.state === "error") {
    setStatus("エラー: " + (m.error || "失敗しました"), "error");
    $("runBtn").disabled = false;
    $("captureBtn").disabled = false;
  }
}

/* ---- シナリオ編集 ---- */
function showScenarioEditor(scenario) {
  $("scenarioBlock").style.display = "";
  $("scenarioEditor").value = JSON.stringify(scenario, null, 2);
  $("scenarioError").textContent = "";
  $("captureBtn").disabled = false;
  $("scenarioBlock").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function submitScenario() {
  let scenario;
  try {
    scenario = JSON.parse($("scenarioEditor").value);
    if (!scenario || !Array.isArray(scenario.steps)) throw new Error("steps 配列がありません。");
  } catch (e) {
    $("scenarioError").textContent = "JSON エラー: " + e.message;
    return;
  }
  $("scenarioError").textContent = "";
  $("captureBtn").disabled = true;
  setStatus("撮影を開始します…", "running");
  try {
    const res = await fetch(`/api/jobs/${currentJobId}/scenario`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "投入に失敗しました。");
  } catch (e) {
    $("scenarioError").textContent = e.message;
    $("captureBtn").disabled = false;
  }
}

/* ---- 成果物 ---- */
function showResult(m) {
  $("resultBlock").style.display = "";
  $("resultSummary").textContent = `全 ${m.stepCount} ステップ・エラー ${m.errorCount} 件。html / zip / site でダウンロードできます。`;
  $("dlHtml").href = `/api/jobs/${currentJobId}/result?format=html`;
  $("dlZip").href = `/api/jobs/${currentJobId}/result?format=zip`;
  $("dlSite").href = `/api/jobs/${currentJobId}/result?format=site`;
  $("preview").src = `/api/jobs/${currentJobId}/manual`;
  $("resultBlock").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---- リセット ---- */
function resetUi() {
  if (es) { es.close(); es = null; }
  logCleared = false;
  $("scenarioBlock").style.display = "none";
  $("resultBlock").style.display = "none";
  markStages("queued");
}

/* ---- 起動時 ---- */
async function init() {
  $("runBtn").addEventListener("click", startJob);
  $("captureBtn").addEventListener("click", submitScenario);
  $("resetScenarioBtn").addEventListener("click", () => {
    if (generatedScenario) $("scenarioEditor").value = JSON.stringify(generatedScenario, null, 2);
  });
  try {
    const h = await (await fetch("/api/health")).json();
    if (!h.hasApiKey) {
      const env = h.keyEnv || "GEMINI_API_KEY";
      const n = $("healthNote");
      n.style.display = "";
      n.textContent = `注意: AIプロバイダ「${h.provider || "gemini"}」のキー（${env}）がサーバーに設定されていません。シナリオ／マニュアル生成は動作しません（${env}=... npm start で起動してください）。`;
    }
  } catch { /* health 取得失敗は無視 */ }
}
init();
