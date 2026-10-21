// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/ci.yml", import.meta.url);

test("gitleaks scans full history without event-derived commit ranges", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.doesNotMatch(workflow, /gitleaks\/gitleaks-action@/);
  assert.match(
    workflow,
    /uses:\s+docker:\/\/ghcr\.io\/gitleaks\/gitleaks@sha256:[a-f0-9]{64}/,
  );
  assert.match(workflow, /args:\s+git --redact --verbose \./);
  assert.doesNotMatch(workflow, /--log-opts/);
  assert.match(workflow, /GIT_CONFIG_COUNT:\s+"1"/);
  assert.match(workflow, /GIT_CONFIG_KEY_0:\s+safe\.directory/);
  assert.match(workflow, /GIT_CONFIG_VALUE_0:\s+\/github\/workspace/);
});

const jobBlock = (workflow, name) =>
  workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:\\n|(?![\\s\\S]))`, "m"))?.[1];

test("CI blocks high-severity vulnerabilities in shipped dependencies", async () => {
  const workflow = (await readFile(workflowUrl, "utf8")).replaceAll("\r\n", "\n");
  const auditJob = jobBlock(workflow, "audit");

  assert.ok(auditJob, "CI workflow must define the audit job");
  // 审计单独成 job、只读提交里的锁文件：不装依赖，中间也就没有任何一步能改动它审的那棵树。
  // 允许 run 之前有注释行（记录门禁口径的理由），命令本身锁死。
  assert.match(
    auditJob,
    /^      - name: Dependency audit\n(?:        #[^\n]*\n)*        run: node scripts\/audit-gate\.mjs$/m,
  );
  assert.doesNotMatch(auditJob, /^\s+run:.*\bnpm (ci|install|i)\b/m);
  // 门禁不许被条件或 continue-on-error 悄悄架空
  assert.doesNotMatch(auditJob, /^\s+if:/m);
  assert.doesNotMatch(workflow, /^\s+continue-on-error:/m);
});

test("lint、test、build 互不阻断：一轮 CI 就把问题全摆出来", async () => {
  // PR #73 红在 test，build 根本没跑——依赖升级到底能不能构建，要等下一轮才知道。
  // 三步都只以「依赖装上了」为前提；装依赖失败时一起跳过，那时它们只会报同一个错。
  const workflow = (await readFile(workflowUrl, "utf8")).replaceAll("\r\n", "\n");
  const verifyJob = jobBlock(workflow, "verify");
  assert.ok(verifyJob, "CI workflow must define the verify job");
  assert.match(verifyJob, /^      - name: Install\n        id: install\n        run: npm ci$/m);
  for (const [name, cmd] of [["Lint", "npm run lint"], ["Test", "npm test"], ["Build", "npm run build"]]) {
    assert.match(
      verifyJob,
      new RegExp(`^      - name: ${name}\\n        if: \\$\\{\\{ !cancelled\\(\\) && steps\\.install\\.outcome == 'success' \\}\\}\\n        run: ${cmd}$`, "m"),
      `${name} 必须在依赖装上之后无条件运行`,
    );
  }
});

test("每一条依赖豁免都必须写清为什么无解、什么条件下能删", async () => {
  // 门禁从 `--omit=dev`（整棵开发依赖树的匿名豁免）换成具名清单之后，
  // 真正要守的就变成了这件事：清单不许悄悄变长，也不许出现一条没写理由的豁免。
  //
  // 清单为空是正常状态（上游把公告修掉了，豁免按 until 条件删掉），此时门禁行为
  // 与「无豁免的全树审计」等价，仍然在干活。要守的不是「至少有一条」，而是下面
  // 这两件：有几条就每条都得写清理由与退出条件，且门禁始终是全树的。
  const src = await readFile(new URL("./audit-gate.mjs", import.meta.url), "utf8");
  const entries = [...src.matchAll(/id:\s*"(GHSA-[\w-]+)"/g)].map((m) => m[1]);
  for (const id of entries) {
    const block = src.slice(src.indexOf(`id: "${id}"`));
    const why = block.match(/why:\s*"([^"]+)"/)?.[1] ?? "";
    const until = block.match(/until:\s*"([^"]+)"/)?.[1] ?? "";
    assert.ok(why.length >= 20, `${id} 缺少「为什么无解」`);
    assert.ok(until.length >= 10, `${id} 缺少「什么条件下能删」`);
  }
  // 门禁必须是全树的：一旦有人把 --omit=dev 那类整棵子树的匿名豁免加回 CI，这条断言就红
  const workflow = await readFile(workflowUrl, "utf8");
  assert.doesNotMatch(workflow, /--omit=dev/);
});

test("新增的测试文件不许静默不跑：npm test 的清单必须覆盖全仓", async () => {
  // package.json 里的 test 脚本是**手写白名单**而非模式匹配。贡献指南明确要求
  // 「引擎改动必须附回归测试」，而新贡献者建一个 src/lib/usage.test.ts 让它本地通过之后，
  // npm test 与 CI 都不会执行它——绿灯、零信号，是最难察觉的那种失败形态。
  //
  // 这里不改成 glob：`node --test` 的 glob 展开在不同 Node 版本上行为不一，把门禁的
  // 可靠性押在运行时语义上不划算。改成让清单漏一个就红。
  const { readdir } = await import("node:fs/promises");
  const root = new URL("../", import.meta.url);
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const script = pkg.scripts.test;

  const found = [];
  const walk = async (rel) => {
    for (const e of await readdir(new URL(rel, root), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      if (e.isDirectory()) await walk(`${rel}${e.name}/`);
      else if (/\.test\.(ts|mjs)$/.test(e.name)) found.push(`${rel}${e.name}`);
    }
  };
  await walk("src/");
  await walk("scripts/");

  const missing = found.filter((f) => !script.includes(f));
  assert.deepEqual(missing, [], `这些测试文件不在 npm test 的清单里，永远不会被执行：${missing.join(", ")}`);
});

test("测试结果只由提交决定：npm test 跑在固定的时钟与时区上", async () => {
  // 演示香柜的四季用例漏传过 now，衰减按跑测试那天算：同一个提交 2026-10-16 绿、10-18 起红，
  // 红在一个只动了锁文件的依赖 PR 上。scripts/test-clock.mjs 把时钟钉在 2031 年、时区钉在
  // Asia/Shanghai；它从 test 脚本里被拿掉，或者装上了却没生效，这条都要红。
  const root = new URL("../", import.meta.url);
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.match(pkg.scripts.test, / --import \.\/scripts\/test-clock\.mjs /);

  // 只看脚本文本不够：路径写错时字面量照样在。直接量本进程——这个文件就是 npm test 跑起来的。
  const src = await readFile(new URL("./test-clock.mjs", import.meta.url), "utf8");
  const iso = src.match(/TEST_EPOCH = Date\.parse\("([^"]+)"\)/)?.[1];
  assert.ok(iso, "test-clock.mjs 里找不到 TEST_EPOCH");
  assert.ok(Math.abs(Date.now() - Date.parse(iso)) < 30 * 60_000, "测试进程的时钟没有被固定");
  assert.equal(new Date().getTimezoneOffset(), -480, "测试进程的时区不是 Asia/Shanghai");
});

test("源码里不许出现裸控制字符——否则 git 把整个文件判成二进制，评审里就看不见它了", async () => {
  // 实锤过一次：src/app/api/context/route.ts 把 /[\x00-\x1f]/ 写成了两个裸字节，
  // 于是 `git show` 与 PR 页面对它只输出「Binary files differ」（一行 diff 都没有）、
  // grep 与 git grep 只回「Binary file matches」。而那正是全站唯一既校验不可信入参
  // （lon / lat / city）、又持有和风密钥的文件——最需要被逐行看见的那一个。
  // gitleaks 走的也是 git patch 通道，对二进制文件基本是盲区。
  //
  // 允许的只有 \t(09) \n(0a) \r(0d)。其余 C0 控制字符与 DEL 一律不许直接写进源码，
  // 要表达它们就用转义形态（/[\x00-\x1f]/）——语义完全等价，而且人看得见。
  const { execSync } = await import("node:child_process");
  const root = new URL("../", import.meta.url);
  const list = execSync("git ls-files -z", { cwd: root, encoding: "buffer" })
    .toString("utf8")
    .split("\0")
    .filter((f) => /\.(ts|tsx|mjs|cjs|js|json|md|yml|yaml|css)$/.test(f));
  assert.ok(list.length > 50, "取不到文件清单时应当直接失败，而不是空跑一遍报绿");

  const offenders = [];
  for (const rel of list) {
    const buf = await readFile(new URL(rel, root));
    for (const byte of buf) {
      if (byte === 9 || byte === 10 || byte === 13) continue;
      if (byte < 0x20 || byte === 0x7f) { offenders.push(rel); break; }
    }
  }
  assert.deepEqual(offenders, [], `这些源码里有裸控制字符，git 会把它们当二进制：${offenders.join(", ")}`);
});
