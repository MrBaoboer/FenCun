// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

// 依赖审计门禁：**全树审计 + 逐条具名豁免**。
//
// 上一版的门禁是 `npm audit --audit-level=high --omit=dev`。理由当时写得清楚：
// 开发链路那批 brace-expansion 公告在当前依赖树里无解（eslint-config-next 内置的
// eslint-plugin-* 锁着 minimatch@3，而 minimatch@3 吃不了改成命名导出的
// brace-expansion@5，1.x 又没有补丁版）。但 `--omit=dev` 是**整棵开发依赖树**的豁免，
// 而且被 ci-workflow.test.mjs 的断言固化成了长期状态：往后 tsx、puppeteer-core、
// 任意 eslint 插件里出现新的 high/critical（含带 postinstall 的供应链投毒）
// 都会照样绿灯，而且没有任何人会注意到。
//
// 手段应该和理由一样窄：全树审计，只放行下面这张清单里逐条写明理由与退出条件的公告。
// 清单之外的任何 high/critical 一律让 CI 红。
//
// 不引入 audit-ci / better-npm-audit 这类新依赖——为一条门禁加一个开发依赖，
// 恰恰是这个仓库的「反过度设计」要挡的动作，而这件事十几行就能自己做完。
import { execSync } from "node:child_process";

/**
 * 具名豁免。每一条都必须写清：为什么无解、什么条件下可以删掉。
 * 加一条之前先问：是真的无解，还是只是升级麻烦？
 *
 * 清单为空是门禁的正常状态，不是机制失效。更早的一条（brace-expansion 的
 * GHSA-mh99-v99m-4gvg）当时判定「1.x 到 1.1.16 终结、无补丁版」，后来上游发了
 * 1.1.18，条件达成即删。
 */
const ALLOW = [
  {
    id: "GHSA-vfj7-8cjw-p6xm",
    package: "braces",
    why: "只在开发链路上（eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces），生产依赖树里没有它。"
      + "braces 3.0.3 已是最新版，公告没有补丁版本；micromatch 4.0.8、fast-glob 3.3.3 也都是最新版，链上换不掉任何一环，"
      + "@next/eslint-plugin-next 的 latest 与 canary 都把 fast-glob 精确钉在 3.3.1。"
      + "唯一调用点 get-root-dirs.js 只展开 ESLint 配置里的 settings.next.rootDir；本仓库没设这一项，默认取 cwd、"
      + "不进 fast-glob，npm run lint 全程实测 braces 调用 0 次。模式只来自开发者写的配置，不来自用户输入。",
    until: "braces 发出修复版且 micromatch 能解析到它，或 @next/eslint-plugin-next 不再依赖 fast-glob。",
  },
];

const allowIds = new Set(ALLOW.map((a) => a.id));
const BLOCKING = new Set(["high", "critical"]);

let raw;
try {
  // 固定命令串、零动态参数——Windows 上 npm 是 .cmd，execFile 直接起会 EINVAL
  raw = execSync("npm audit --json", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (e) {
  // 有漏洞时 npm audit 以非零码退出，报告仍在 stdout —— 这是正常路径，不是失败
  raw = e.stdout;
  if (!raw) {
    console.error("npm audit 没有产出报告：", e.message);
    process.exit(1);
  }
}

const report = JSON.parse(raw);
const findings = [];
for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
  if (!BLOCKING.has(v.severity)) continue;
  // via 里混着字符串（间接引入的包名）与对象（真正的公告）
  const advisories = (v.via ?? []).filter((x) => typeof x === "object");
  if (advisories.length === 0) {
    // 纯传递性条目：它的公告会在源头那一项里出现，不重复计
    continue;
  }
  for (const a of advisories) {
    // 包的 severity 是它名下公告的最高档，只能用来跳过整包。要按公告逐条判：否则同一个包里
    // 只要有一条 high，旁边的 moderate 也会被拦下，还被算进「high/critical」的条数
    const severity = a.severity ?? v.severity;
    if (!BLOCKING.has(severity)) continue;
    const id = String(a.url ?? "").split("/").pop() || String(a.source);
    // 同一条公告按受影响的版本段各出一项（比如 1.x 与 5.x 各装了一份），打印时带上版本段
    findings.push({ name, id, title: a.title, severity, range: a.range ?? "" });
  }
}

const unexpected = findings.filter((f) => !allowIds.has(f.id));
const used = new Set(findings.map((f) => f.id));

for (const f of findings) {
  const mark = allowIds.has(f.id) ? "· 已具名豁免" : "✖ 未豁免";
  console.log(`${mark}  [${f.severity}] ${f.name} ${f.range}  ${f.id}  ${f.title ?? ""}`);
}

// 豁免过期也要说出来：留着一条早就不再触发的豁免，等于给未来的漏洞留了一扇没人记得的门
for (const a of ALLOW) {
  if (!used.has(a.id)) {
    console.log(`· 豁免 ${a.id}（${a.package}）已不再触发，可以从 scripts/audit-gate.mjs 删掉了`);
  }
}

if (unexpected.length > 0) {
  console.error(`\n有 ${new Set(unexpected.map((f) => f.id)).size} 条未豁免的 high/critical 公告。`);
  console.error("要么升级依赖，要么在 scripts/audit-gate.mjs 的 ALLOW 里写清为什么无解、什么条件下能删。");
  process.exit(1);
}

console.log(
  findings.length === 0
    ? "\n依赖审计通过：全树扫描，无 high/critical 公告。"
    : `\n依赖审计通过：全树扫描，${used.size} 条 high/critical 全部具名豁免。`,
);
