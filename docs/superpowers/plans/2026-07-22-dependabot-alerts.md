# Dependabot 高危告警修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 消除 `sharp` 与 `brace-expansion` 的全部未解决 Dependabot 高危告警，并让 CI 阻止新的高危 npm 漏洞进入 `main`。

**架构：** 保留 Next.js 16.2.10，不接受 `npm audit fix --force` 建议的破坏性框架降级。通过 npm `overrides` 将 Next.js 的可选运行时依赖 `sharp` 提升到已修复的 0.35.x，并让锁文件把 ESLint 依赖链中的 `brace-expansion` 更新到 1.1.16；同时在现有 CI 验证任务中加入高危依赖审计门禁。

**技术栈：** npm lockfile v3、Next.js 16、Node.js 22 CI、Node.js 原生测试、GitHub Actions、Dependabot

---

### 任务 1：添加高危依赖审计门禁

**文件：**
- 修改：`scripts/ci-workflow.test.mjs`
- 修改：`.github/workflows/ci.yml`

- [x] **步骤 1：编写失败的工作流回归测试**

在 `scripts/ci-workflow.test.mjs` 中添加：

```js
test("CI blocks high-severity dependency vulnerabilities", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /name:\s+Dependency audit/);
  assert.match(workflow, /run:\s+npm audit --audit-level=high/);
});
```

- [x] **步骤 2：运行测试并确认按预期失败**

运行：`node --test scripts/ci-workflow.test.mjs`

预期：新增测试失败，指出 `.github/workflows/ci.yml` 缺少 `Dependency audit` 或 `npm audit --audit-level=high`。

- [x] **步骤 3：向 CI 加入最小实现**

在 `.github/workflows/ci.yml` 的 `npm ci` 之后添加：

```yaml
      - name: Dependency audit
        run: npm audit --audit-level=high
```

- [x] **步骤 4：重新运行工作流测试**

运行：`node --test scripts/ci-workflow.test.mjs`

预期：2 项工作流测试全部通过。

- [x] **步骤 5：提交审计门禁**

```powershell
git add scripts/ci-workflow.test.mjs .github/workflows/ci.yml docs/superpowers/plans/2026-07-22-dependabot-alerts.md
git commit -m "ci: 阻止高危依赖漏洞进入主分支"
```

### 任务 2：修复两条易受攻击的依赖链

**文件：**
- 修改：`package.json`
- 修改：`package-lock.json`

- [ ] **步骤 1：确认安全审计失败基线**

运行：`npm audit --json`

预期：退出码为 1；报告 `sharp < 0.35.0`、`brace-expansion < 1.1.16`，高危节点合计 3 个。

- [ ] **步骤 2：约束 Next.js 使用已修复的 sharp**

在 `package.json` 的 `overrides` 中加入：

```json
"sharp": "^0.35.3"
```

保留已有的 `postcss` override。

- [ ] **步骤 3：重新解析受影响依赖**

运行：`npm install`

随后运行：`npm update brace-expansion`

预期：`package-lock.json` 中 `node_modules/sharp` 为 0.35.3 或更高的 0.35.x，顶层 `node_modules/brace-expansion` 为 1.1.16 或更高的 1.x；不改动 `brace-expansion` 5.x 的独立依赖节点。

- [ ] **步骤 4：验证依赖图与安全审计**

运行：`npm ls sharp brace-expansion --all`

预期：Next.js 解析到安全的 sharp 0.35.x，ESLint 的 minimatch 3.x 解析到安全的 brace-expansion 1.1.16，依赖树无 invalid/extraneous 错误。

运行：`npm audit --audit-level=high`

预期：退出码为 0，报告 0 vulnerabilities。

- [ ] **步骤 5：提交依赖修复**

```powershell
git add package.json package-lock.json
git commit -m "fix(deps): 修复 Dependabot 高危告警"
```

### 任务 3：完整回归与可复现安装验证

**文件：**
- 验证：`package.json`
- 验证：`package-lock.json`
- 验证：`.github/workflows/ci.yml`
- 验证：`scripts/ci-workflow.test.mjs`

- [ ] **步骤 1：从锁文件重新安装**

运行：`npm ci`

预期：退出码为 0，审计摘要为 0 vulnerabilities，且 `git status --short` 不产生新的文件变化。

- [ ] **步骤 2：执行完整项目验证**

依次运行：

```powershell
npm audit --audit-level=high
npm test
npm run lint
npm run build
```

预期：所有命令退出码为 0；测试 61 项或更多、0 失败；lint 无错误；Next.js 生产构建成功。

- [ ] **步骤 3：核对告警修复范围**

运行：`git diff main...HEAD -- package.json package-lock.json .github/workflows/ci.yml scripts/ci-workflow.test.mjs docs/superpowers/plans/2026-07-22-dependabot-alerts.md`

预期：差异仅包含依赖修复、审计门禁、回归测试和本计划，不包含原工作区的未提交文档变更。
