/**
 * ============================================================
 *  かんたん設定ファイル（API キーはここに貼るだけ）
 * ============================================================
 *  使い方:
 *    1) このファイルを config.js という名前でコピー
 *         cp config.example.js config.js
 *    2) 下の GEMINI_API_KEY か DIFY_API_KEY に自分のキーを貼る
 *    3) npm start
 *
 *  config.js は .gitignore 済み（キーはコミットされません）。
 *  ※ 環境変数 / .env を設定している場合はそちらが優先されます。
 * ============================================================
 */
export default {
  // 使う AI を選ぶ: "gemini"（既定） または "dify"
  AI_PROVIDER: "gemini",

  // ── Gemini を使う場合 ──
  GEMINI_API_KEY: "",                 // ← ここに "AIza..." を貼る
  GEMINI_MODEL: "gemini-2.5-flash",   // 任意

  // ── Dify を使う場合（AI_PROVIDER を "dify" に） ──
  DIFY_API_KEY: "",                   // ← ここに "app-..." を貼る
  DIFY_BASE_URL: "https://api.dify.ai/v1", // セルフホスト時のみ変更

  // サーバー
  PORT: 5179,
};
