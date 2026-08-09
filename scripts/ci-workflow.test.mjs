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

test("CI blocks high-severity vulnerabilities in shipped dependencies", async () => {
  const workflow = (await readFile(workflowUrl, "utf8")).replaceAll("\r\n", "\n");
  const verifyJob = workflow.match(
    /^  verify:\n([\s\S]*?)(?=^  [\w-]+:\n|(?![\s\S]))/m,
  );

  assert.ok(verifyJob, "CI workflow must define the verify job");
  // 允许 run 之前有注释行（记录门禁口径的理由），但 Install → Dependency audit
  // 的相邻顺序与命令本身仍然锁死
  assert.match(
    verifyJob[1],
    /^      - name: Install\n        run: npm ci\n      - name: Dependency audit\n(?:        #[^\n]*\n)*        run: node scripts\/audit-gate\.mjs$/m,
  );
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
