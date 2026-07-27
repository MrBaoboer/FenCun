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
  // 允许 run 之前有注释行（记录 --omit=dev 的理由），但 Install → Dependency audit
  // 的相邻顺序与命令本身仍然锁死
  assert.match(
    verifyJob[1],
    /^      - name: Install\n        run: npm ci\n      - name: Dependency audit\n(?:        #[^\n]*\n)*        run: npm audit --audit-level=high --omit=dev$/m,
  );
});
