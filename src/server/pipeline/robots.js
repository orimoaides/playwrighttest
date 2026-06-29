/**
 * 最小限の robots.txt パーサ／判定。
 * User-agent グループ（* と一致UA）の Disallow/Allow を読み、パスを prefix + ワイルドカードで判定する。
 * 完全な RFC 準拠ではないが「巡回先制御を尊重する」目的には十分。
 */

/**
 * robots.txt テキストを解析し、対象 UA に適用されるルール群を返す。
 * @param {string} text
 * @param {string} userAgent
 * @returns {{allow: string[], disallow: string[]}}
 */
export function parseRobots(text, userAgent = "*") {
  const lines = text.split(/\r?\n/);
  /** @type {Record<string, {allow:string[], disallow:string[]}>} */
  const groups = {};
  let current = [];
  let expectingAgent = false;

  for (let raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!expectingAgent) {
        current = [];
        expectingAgent = true;
      }
      const ua = value.toLowerCase();
      groups[ua] = groups[ua] || { allow: [], disallow: [] };
      current.push(groups[ua]);
    } else if (field === "allow" || field === "disallow") {
      expectingAgent = false;
      for (const g of current) {
        if (value === "" && field === "disallow") continue; // 空 Disallow は「全許可」
        g[field].push(value);
      }
    } else {
      expectingAgent = false;
    }
  }

  const ua = userAgent.toLowerCase();
  const picked = groups[ua] || groups["*"] || { allow: [], disallow: [] };
  return picked;
}

/**
 * robots パターンにパスが一致するか（* と末尾 $ をサポート）。
 * @param {string} path
 * @param {string} pattern
 */
function matches(path, pattern) {
  if (pattern === "") return false;
  // 正規表現へ変換: * → .*  末尾 $ はアンカー
  let anchored = false;
  let p = pattern;
  if (p.endsWith("$")) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const re = new RegExp("^" + escaped + (anchored ? "$" : ""));
  return re.test(path);
}

/**
 * 指定パスが許可されているか判定（Allow が Disallow より長く一致すれば許可、という慣例）。
 * @param {{allow:string[], disallow:string[]}} rules
 * @param {string} path
 */
export function isAllowed(rules, path) {
  let bestDisallow = -1;
  let bestAllow = -1;
  for (const d of rules.disallow) if (matches(path, d) && d.length > bestDisallow) bestDisallow = d.length;
  for (const a of rules.allow) if (matches(path, a) && a.length > bestAllow) bestAllow = a.length;
  if (bestDisallow === -1) return true;
  return bestAllow >= bestDisallow;
}

/**
 * origin の robots.txt を取得して判定関数を返す。取得失敗時は「全許可」。
 * @param {string} origin
 * @param {string} userAgent
 */
export async function loadRobots(origin, userAgent = "*") {
  let rules = { allow: [], disallow: [] };
  try {
    const res = await fetch(origin + "/robots.txt", { signal: AbortSignal.timeout(8000) });
    if (res.ok) rules = parseRobots(await res.text(), userAgent);
  } catch {
    /* robots.txt なし → 全許可 */
  }
  return {
    /** @param {string} url */
    allows(url) {
      try {
        const u = new URL(url);
        return isAllowed(rules, u.pathname + u.search);
      } catch {
        return true;
      }
    },
  };
}
