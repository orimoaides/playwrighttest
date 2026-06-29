/**
 * capture() ★最重要: scenario の各 step を実 Playwright で再生し、steps（契約[3]）を
 * 実データで埋める。
 *  - 操作の直前/直後で page.screenshot（前後ペア）
 *  - クリック対象を locator.boundingBox() で取得し、sharp で赤枠ハイライトを合成。座標を highlight に保存
 *  - page.on('console') / page.on('response') を仕込み、エラーと主要遷移だけ consoleLogs に
 *  - networkidle / waitForSelector で撮影タイミングを安定化
 *  - step 単位 try/catch。失敗 step は status:"error" で記録し全体は止めない
 *
 * TODO(phase3): core の capture モジュールとして切り出す（SourceAdapter 非依存）。
 */

import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { summarizeActions } from "../../shared/types.js";

const VIEWPORT = { width: 1280, height: 800 };

/**
 * @param {import('playwright').Browser} browser
 * @param {import('../../shared/types.js').Scenario} scenario
 * @param {string} shotsDir  スクショ保存先ディレクトリ（絶対パス）
 * @param {(msg:string, level?:string)=>void} [log]
 * @returns {Promise<import('../../shared/types.js').Steps>}
 */
export async function capture(browser, scenario, shotsDir, log = () => {}) {
  await fs.mkdir(shotsDir, { recursive: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  /** @type {import('../../shared/types.js').StepResult[]} */
  const out = [];

  try {
    for (let i = 0; i < scenario.steps.length; i++) {
      const s = scenario.steps[i];
      log(`capture (${i + 1}/${scenario.steps.length}) ${s.id} ${s.url}`, "start");

      const beforeRel = `shots/${s.id}-before.png`;
      const afterRel = `shots/${s.id}-after.png`;
      const beforeAbs = path.join(shotsDir, `${s.id}-before.png`);
      const afterAbs = path.join(shotsDir, `${s.id}-after.png`);

      const page = await context.newPage();
      const logs = [];
      page.on("console", (m) => {
        const t = m.type();
        if (t === "error" || t === "warning") logs.push(`[console:${t}] ${m.text()}`.slice(0, 200));
      });
      page.on("response", (r) => {
        const st = r.status();
        if (st >= 400) logs.push(`[response:${st}] ${r.url()}`.slice(0, 200));
      });
      page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`.slice(0, 200)));

      /** @type {import('../../shared/types.js').Highlight|null} */
      let highlight = null;
      let status = "ok";

      try {
        await page.goto(s.url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});

        // 操作対象（最初の selector 付き action）を特定し、ハイライト座標を取得
        const target = (s.actions || []).find((a) => a.selector && (a.type === "click" || a.type === "fill"));
        if (target) {
          try {
            const loc = page.locator(target.selector).first();
            await loc.waitFor({ state: "visible", timeout: 4000 });
            await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
            const box = await loc.boundingBox();
            if (box) highlight = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
          } catch {
            log(`${s.id}: 操作対象 "${target.selector}" が見つからずハイライト省略`, "warn");
          }
        }

        // 操作前スクショ → 赤枠を合成
        await page.screenshot({ path: beforeAbs });
        if (highlight) await drawHighlight(beforeAbs, highlight);

        // アクション実行
        await runActions(page, s.actions || [], log, s.id);

        // 操作後スクショ
        await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
        await page.screenshot({ path: afterAbs });
      } catch (e) {
        status = "error";
        logs.push(`[capture-error] ${e.message}`.slice(0, 200));
        log(`${s.id} 失敗: ${e.message}`, "err");
        // 失敗時も可能な範囲でスクショを残す
        await page.screenshot({ path: afterAbs }).catch(() => {});
        await ensureFile(beforeAbs);
        await ensureFile(afterAbs);
      } finally {
        await page.close();
      }

      out.push({
        id: s.id,
        name: s.name,
        description: s.description,
        url: s.url,
        action: summarizeActions(s),
        screenshotBefore: beforeRel,
        screenshotAfter: afterRel,
        highlight,
        consoleLogs: dedupe(logs).slice(0, 8),
        status,
      });
      if (status === "ok") log(`${s.id} OK`, "ok");
    }
  } finally {
    await context.close();
  }

  return { steps: out };
}

/**
 * scenario.actions を順に実行する。
 * @param {import('playwright').Page} page
 * @param {import('../../shared/types.js').ScenarioAction[]} actions
 */
async function runActions(page, actions, log, stepId) {
  for (const a of actions) {
    try {
      if (a.type === "fill" && a.selector) {
        await page.locator(a.selector).first().fill(a.value ?? "<sample>", { timeout: 4000 });
      } else if (a.type === "click" && a.selector) {
        await page.locator(a.selector).first().click({ timeout: 4000 });
      } else if (a.type === "goto") {
        await page.goto(a.selector || page.url(), { waitUntil: "domcontentloaded", timeout: 15000 });
      } else if (a.type === "wait") {
        await page.waitForTimeout(800);
      }
    } catch (e) {
      // 個々のアクション失敗は警告に留め、ステップは継続（status は呼び出し側で error 判定しない）
      log(`${stepId}: action ${a.type}(${a.selector || ""}) 失敗: ${e.message}`, "warn");
    }
  }
}

/**
 * 画像に赤枠ハイライトを合成する（sharp）。
 * @param {string} imgPath
 * @param {import('../../shared/types.js').Highlight} hl
 */
async function drawHighlight(imgPath, hl) {
  try {
    const meta = await sharp(imgPath).metadata();
    const W = meta.width || VIEWPORT.width;
    const H = meta.height || VIEWPORT.height;
    const pad = 4;
    const x = Math.max(0, hl.x - pad);
    const y = Math.max(0, hl.y - pad);
    const w = Math.min(W - x, hl.width + pad * 2);
    const h = Math.min(H - y, hl.height + pad * 2);
    const svg = Buffer.from(
      `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
         <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#ff3b30" stroke-width="4" rx="6"/>
       </svg>`
    );
    const composited = await sharp(imgPath).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
    await fs.writeFile(imgPath, composited);
  } catch {
    /* 合成失敗時は枠なし画像のまま */
  }
}

async function ensureFile(p) {
  try {
    await fs.access(p);
  } catch {
    // 1x1 透明 PNG を置いてリンク切れを防ぐ
    const px = await sharp({ create: { width: 640, height: 360, channels: 4, background: "#eeeeee" } }).png().toBuffer();
    await fs.writeFile(p, px);
  }
}

function dedupe(arr) {
  return [...new Set(arr)];
}
