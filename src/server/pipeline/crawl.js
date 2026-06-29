/**
 * crawl(): 起点URLから同一オリジン BFS で routes（契約[1]）を生成する。
 * - 深さ・最大ページ数・除外パターンを設定可能
 * - robots.txt を尊重し、レート制御（待機）を行う
 * - Playwright で実レンダリング後の <a href> を収集（JS描画リンクも拾える）
 *
 * TODO(phase3): SourceAdapter.listPages() として core に切り出す（UrlCrawlAdapter）。
 */

import { loadRobots } from "./robots.js";

const DEFAULTS = {
  maxDepth: 2,
  maxPages: 20,
  // 既定で堅めの除外（破壊的/無関係なURL）
  excludePatterns: ["/logout", "/signout", "/api/", "/cdn-cgi/"],
  waitMs: 400, // 1ページごとの待機（レート制御）
  respectRobots: true,
  userAgent: "ManualGeneratorBot",
  navTimeoutMs: 20000,
};

/**
 * @param {import('playwright').Browser} browser
 * @param {string} startUrl
 * @param {Partial<typeof DEFAULTS>} [options]
 * @param {(msg: string, level?: string) => void} [log]
 * @returns {Promise<{routes: import('../../shared/types.js').Routes, summaries: PageSummary[]}>}
 *
 * @typedef {Object} PageSummary
 * @property {string} url
 * @property {string} title
 * @property {string[]} headings
 * @property {{selector:string, kind:string, label:string}[]} controls  操作対象候補
 */
export async function crawl(browser, startUrl, options = {}, log = () => {}) {
  const opt = { ...DEFAULTS, ...options };
  const start = new URL(startUrl);
  const origin = start.origin;

  const robots = opt.respectRobots
    ? await loadRobots(origin, opt.userAgent)
    : { allows: () => true };

  const context = await browser.newContext({ userAgent: opt.userAgent });
  const page = await context.newPage();

  const seen = new Set();
  /** @type {import('../../shared/types.js').RouteEntry[]} */
  const routes = [];
  /** @type {PageSummary[]} */
  const summaries = [];
  /** @type {{url:string, depth:number}[]} */
  const queue = [{ url: normalize(startUrl), depth: 0 }];
  seen.add(normalize(startUrl));

  const excluded = (url) => opt.excludePatterns.some((p) => url.includes(p));

  try {
    while (queue.length > 0 && routes.length < opt.maxPages) {
      const { url, depth } = queue.shift();

      if (!robots.allows(url)) {
        log(`robots.txt により除外: ${url}`, "warn");
        continue;
      }

      let title = url;
      let links = [];
      let summary = { url, title: url, headings: [], controls: [] };
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: opt.navTimeoutMs });
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        title = (await page.title().catch(() => "")) || url;
        links = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
        summary = await extractSummary(page, url, title);
      } catch (e) {
        log(`取得失敗（スキップ）: ${url} (${e.message})`, "warn");
        continue;
      }

      routes.push({ url, title: title.trim() || url, depth });
      summaries.push(summary);
      log(`巡回: [d${depth}] ${url} → ${title.slice(0, 40)}`, "ok");

      // レート制御
      if (opt.waitMs > 0) await sleep(opt.waitMs);

      if (depth >= opt.maxDepth) continue;

      for (const raw of links) {
        if (!raw || /^(#|mailto:|tel:|javascript:)/i.test(raw)) continue;
        let abs;
        try {
          abs = new URL(raw, url);
        } catch {
          continue;
        }
        if (abs.origin !== origin) continue; // 同一オリジンのみ
        abs.hash = "";
        const n = normalize(abs.href);
        if (seen.has(n) || excluded(n)) continue;
        seen.add(n);
        queue.push({ url: n, depth: depth + 1 });
      }
    }
  } finally {
    await context.close();
  }

  if (routes.length === 0) throw new Error("routes が0件でした（起点URLを取得できませんでした）。");
  log(`crawl 完了: ${routes.length} ページ`, "ok");
  return { routes: { origin, routes }, summaries };
}

/**
 * ページから操作対象候補（見出し・フォーム要素・主要ボタン）を抽出する。
 * Gemini に渡すと、実在するセレクタを使った scenario を作りやすくなる。
 * @param {import('playwright').Page} page
 */
async function extractSummary(page, url, title) {
  const data = await page.evaluate(() => {
    const cssEscape = (s) =>
      window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, "\\$&");
    const sel = (el) => {
      if (el.id) return `#${cssEscape(el.id)}`;
      const name = el.getAttribute("name");
      if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
      const type = el.getAttribute("type");
      if (type) return `${el.tagName.toLowerCase()}[type="${type}"]`;
      return el.tagName.toLowerCase();
    };
    const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
      .map((h) => h.textContent.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 8);
    const controls = [];
    for (const el of Array.from(document.querySelectorAll("input,textarea,select")).slice(0, 12)) {
      controls.push({
        selector: sel(el),
        kind: el.tagName.toLowerCase() === "input" ? `input:${el.getAttribute("type") || "text"}` : el.tagName.toLowerCase(),
        label: (el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.getAttribute("name") || "").slice(0, 40),
      });
    }
    for (const el of Array.from(document.querySelectorAll("button,[role=button],input[type=submit]")).slice(0, 8)) {
      controls.push({
        selector: sel(el),
        kind: "button",
        label: (el.textContent || el.getAttribute("value") || "").replace(/\s+/g, " ").trim().slice(0, 40),
      });
    }
    return { headings, controls };
  }).catch(() => ({ headings: [], controls: [] }));
  return { url, title: (title || "").trim() || url, headings: data.headings, controls: data.controls };
}

function normalize(href) {
  try {
    const u = new URL(href);
    u.hash = "";
    // 末尾スラッシュの揺れを軽く吸収
    return u.href;
  } catch {
    return href;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
