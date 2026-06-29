/**
 * 起動ランチャー。
 * config.js があれば読み込み、process.env に反映してからサーバーを起動する。
 * → API キーは config.js に貼るだけでよい（.env / 環境変数も併用可・そちらが優先）。
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cfgUrl = new URL("./config.js", import.meta.url);
if (existsSync(fileURLToPath(cfgUrl))) {
  try {
    const cfg = (await import(cfgUrl.href)).default || {};
    let n = 0;
    for (const [k, v] of Object.entries(cfg)) {
      // 値が入っていて、かつ環境変数が未設定のときだけ反映（env を優先）
      if (v !== "" && v != null && process.env[k] === undefined) {
        process.env[k] = String(v);
        n++;
      }
    }
    console.log(`  config.js を読み込みました（${n} 項目）。`);
  } catch (e) {
    console.warn("  config.js の読み込みに失敗しました:", e.message);
  }
}

// process.env を整えた後にサーバー本体を読み込む
await import("./src/server/index.js");
