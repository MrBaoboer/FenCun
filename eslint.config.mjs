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
