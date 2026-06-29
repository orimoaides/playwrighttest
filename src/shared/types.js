/**
 * =================================================================================
 * ★ データ契約 JSON 3種（全フェーズ共通契約・キー名厳守）★
 *
 * フェーズ①(Gemini Canvas版) で確定したキー名・構造を一切変更しない。
 * フェーズ②では steps の screenshotBefore/After・highlight・consoleLogs を
 * ダミーから実データ（実Playwright）に差し替える。新機能は常に「既存契約への追加」
 * であって「変更」にはしない。フロント／サーバー双方がこのモジュールを参照する。
 * =================================================================================
 */

/**
 * [1] routes — 同一オリジン BFS 巡回の結果
 * @typedef {Object} Routes
 * @property {string} origin                例: "https://example.com"
 * @property {RouteEntry[]} routes
 *
 * @typedef {Object} RouteEntry
 * @property {string} url
 * @property {string} title
 * @property {number} depth                 起点からの BFS 深さ
 */

/**
 * [2] scenario — Gemini に responseSchema で生成させる「重要画面と操作」
 * @typedef {Object} Scenario
 * @property {string} baseUrl
 * @property {ScenarioStep[]} steps
 *
 * @typedef {Object} ScenarioStep
 * @property {string} id                    "step-01" のようなゼロ埋め連番
 * @property {string} name
 * @property {string} description
 * @property {string} url
 * @property {ScenarioAction[]} actions     空配列可
 *
 * @typedef {Object} ScenarioAction
 * @property {"click"|"fill"|"goto"|"wait"} type
 * @property {string} [selector]
 * @property {string} [value]               fill のサンプル値（個人情報は使わない）
 */

/**
 * [3] steps — フェーズ②で実データに差し替え済み
 * @typedef {Object} Steps
 * @property {StepResult[]} steps
 *
 * @typedef {Object} StepResult
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} url
 * @property {string} action                 人間可読な操作要約
 * @property {string} screenshotBefore       実スクショの相対パス（例 "shots/step-01-before.png"）
 * @property {string} screenshotAfter        実スクショの相対パス
 * @property {Highlight|null} highlight       操作対象の bounding box（赤枠合成に使用）
 * @property {string[]} consoleLogs          エラー/主要遷移のみ抽出
 * @property {"ok"|"error"} status
 *
 * @typedef {Object} Highlight
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/** scenario.actions[].type の許可値 */
export const ACTION_TYPES = /** @type {const} */ (["click", "fill", "goto", "wait"]);

/** ダウンロード形式 */
export const RESULT_FORMATS = /** @type {const} */ (["html", "zip", "site"]);

/**
 * Gemini responseSchema: scenario.steps[] の1要素（自由記述を禁止し構造を強制）
 * フェーズ①と同一構造。
 */
export const SCENARIO_STEP_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    url: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...ACTION_TYPES] },
          selector: { type: "string" },
          value: { type: "string" },
        },
        required: ["type"],
      },
    },
  },
  required: ["id", "name", "description", "url", "actions"],
};

/** Gemini responseSchema: scenario 全体 */
export const SCENARIO_SCHEMA = {
  type: "object",
  properties: { steps: { type: "array", items: SCENARIO_STEP_SCHEMA } },
  required: ["steps"],
};

/** Gemini responseSchema: manual の1ステップ説明文 */
export const MANUAL_STEP_SCHEMA = {
  type: "object",
  properties: { heading: { type: "string" }, body: { type: "string" } },
  required: ["heading", "body"],
};

/**
 * scenario.actions[] を人間可読な action 文字列へ要約する（steps.action に使用）。
 * フェーズ①の runStepsMock と同じ体裁を保つ。
 * @param {ScenarioStep} s
 * @returns {string}
 */
export function summarizeActions(s) {
  if (!s.actions || s.actions.length === 0) return "ページを開いて内容を確認";
  return s.actions
    .map((a) => {
      if (a.type === "fill") return `「${a.selector}」に "${a.value ?? "<sample>"}" を入力`;
      if (a.type === "click") return `「${a.selector}」をクリック`;
      if (a.type === "goto") return `「${a.selector || s.url}」へ遷移`;
      if (a.type === "wait") return "待機";
      return a.type;
    })
    .join(" → ");
}

/**
 * ゼロ埋め step id を作る（"step-01"）。
 * @param {number} index 0始まり
 */
export function makeStepId(index) {
  return `step-${String(index + 1).padStart(2, "0")}`;
}
