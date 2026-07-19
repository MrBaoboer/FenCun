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
});
