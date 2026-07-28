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
 */
const ALLOW = [
  {
    id: "GHSA-mh99-v99m-4gvg",
    package: "brace-expansion",
    why: "仅出现在开发链路（eslint 插件 → minimatch@3 → brace-expansion@1）。"
      + "1.x 到 1.1.16 终结、无补丁版；全局 override 到 5.x 会让 eslint 起不来（5.x 改成命名导出，"
      + "minimatch@3 的 require 拿到对象）；升 eslint@10 又会打断 eslint-config-next 内置的 eslint-plugin-react。",
    until: "上游 eslint-plugin-* 迁到新的 minimatch 之后即可删除本条。",
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
    const id = String(a.url ?? "").split("/").pop() ?? a.source;
    findings.push({ name, id, title: a.title, severity: a.severity ?? v.severity });
  }
}

const unexpected = findings.filter((f) => !allowIds.has(f.id));
const used = new Set(findings.map((f) => f.id));

for (const f of findings) {
  const mark = allowIds.has(f.id) ? "· 已具名豁免" : "✖ 未豁免";
  console.log(`${mark}  [${f.severity}] ${f.name}  ${f.id}  ${f.title ?? ""}`);
}

// 豁免过期也要说出来：留着一条早就不再触发的豁免，等于给未来的漏洞留了一扇没人记得的门
for (const a of ALLOW) {
  if (!used.has(a.id)) {
    console.log(`· 豁免 ${a.id}（${a.package}）已不再触发，可以从 scripts/audit-gate.mjs 删掉了`);
  }
}

if (unexpected.length > 0) {
  console.error(`\n有 ${unexpected.length} 条未豁免的 high/critical 公告。`);
  console.error("要么升级依赖，要么在 scripts/audit-gate.mjs 的 ALLOW 里写清为什么无解、什么条件下能删。");
  process.exit(1);
}

console.log(`\n依赖审计通过：全树扫描，${findings.length} 条 high/critical 全部具名豁免。`);
