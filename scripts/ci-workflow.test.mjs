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

test("CI blocks high-severity dependency vulnerabilities", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /name:\s+Dependency audit/);
  assert.match(workflow, /run:\s+npm audit --audit-level=high/);
});
