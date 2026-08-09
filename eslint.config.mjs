// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 本项目自己的暂存目录。它在 .gitignore 里，所以 `git status` 永远干净，
    // 而 eslint **不读** .gitignore——于是随手往 .scratch 放一个临时 .ts 排查脚本，
    // `npm run lint` 就会红，而且红的是一个 git 看不见的文件。
    // 实测过一次：干净工作树上 npm run lint 报 8 个 error，全部来自这里。
    // 项目自己的 README 与截图流程都在往 .scratch 写东西，这不是意外用法。
    ".scratch/**",
  ]),
  {
    // eslint-plugin-react-hooks v6 随 React Compiler 引入的两条严格规则。本项目未启用
    // React Compiler，这两条会对「事件处理器里的 Date.now」「挂载时同步 setState 以规避水合不匹配」
    // 等有意为之的模式误报。降为 warn：问题仍可见、可逐步整改，但不阻断 CI（lint 保持通过）。
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
]);

export default eslintConfig;
