# 贡献指南

> English version: [CONTRIBUTING_EN.md](CONTRIBUTING_EN.md)

## 这个项目欢迎什么

- 🐛 Bug 修复与边界情况加固
- 🌡️ 规则引擎的准确性改进（打分 / 用法 / 用香裁决），**须附诊断或测试**
- 🈶 香名 / 品牌 / 香调中文映射的补全与纠正
- 📝 文档、文案、可访问性与国际化改进
- ✨ 与产品定位一致的新能力（会动到产品边界的，请先开 Issue 对齐）

不太合适的：见下文「四条戒律」与「治理」的负面清单。

## 动手前：四条戒律（硬约束）

任何贡献都必须守住这四条（全文与理由见 [README](../README.md#四条戒律)）：

1. **不伪精确** —— 留香 / 喷量 / 社交距离只给区间与档位。
2. **不过度设计** —— 不上向量库、不引重后端；同一个概念只留一处判据。
3. **轻冷启动** —— 搜名秒加建香柜，不逼用户先填问卷。
4. **有反馈闭环** —— 新增的推荐 / 判断必须可评价、可修正，且反馈要有可测试的消费路径。

## 架构须知

- **决策权在规则引擎，表达权在 LLM。** 匹配打分、喷量 / 距离 / 留香判定必须是确定性规则（可解释、可复现、可单测）；DeepSeek 只负责听懂自然语言场景、把规则算好的事实翻成人话。
- **天气永远来自和风天气 API，绝不让 LLM 编造。**
- **优雅降级优先。** DeepSeek 超时、天气或定位失败都要有兜底，核心推荐照常出，产品不白屏。
- **优先用现成的本地规则与静态数据**，要新增基础设施先说明为什么非它不可。

规则背后的领域依据见[领域规则手册](../docs/领域规则手册.md)，改用户可见的字之前先读[声音与文案](../docs/声音与文案.md)。

## 本地开发

需要 **Node 24**（Active LTS）。版本以 `package.json` 的 `engines.node` 为准——Vercel 直接读它、覆盖面板设置，CI 的 `node-version` 与它保持同一个大版本；用别的大版本装依赖会看到一条 `EBADENGINE` 警告。

```bash
git clone https://github.com/MrBaoboer/FenCun.git
cd FenCun
npm ci
cp .env.example .env.local   # 可选：要调试实时天气或 DeepSeek 时才需要填 key
npm run dev                  # http://localhost:3000
```

不配 key 也能跑：天气走「季节 + 时段」降级，解读走规则模板。目录导航见 [README 的「目录结构」](../README.md#目录结构)。

## 提交前自检

```bash
npm run lint    # 代码风格
npm test        # 单测：改了引擎 / 香历 / 搜索 / 存储 / 钩子 / API 路由的逻辑必须让它过，并补用例
npm run build   # 确保能构建
```

只改文档的 PR 不必跑这三条，但要自己核一遍：链接可达、命令能跑、术语与 `format.ts` 一致、中英两份内容对得上。

## 提交规范

- 采用 [Conventional Commits](https://www.conventionalcommits.org/)：`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `polish:` 等。正文写中文完全 OK，与现有历史一致。
- **建议**（不是硬要求）对提交做 DCO 签名：

  ```bash
  git commit -s -m "fix: ……"
  ```

  `-s` 会附上 `Signed-off-by`，表示你按 [Developer Certificate of Origin](https://developercertificate.org/) 声明自己有权提交这份代码。CI 不校验它。

## Pull Request 流程

1. 从 `main` 开分支，保持提交聚焦、可回溯。
2. 在 PR 描述里写清楚**动机**与**验证方式**；改了引擎的，请附上前后对比或测试。
3. 目标分支为 `main`；CI / 构建须通过。

## 治理 / Governance

- **谁说了算**：氛寸由 [@MrBaoboer](https://github.com/MrBaoboer) 单人维护。维护者掌握产品边界、部署节奏、域名与合并权，可关闭越界、风险过高或验证不足的 PR。
- **什么不进主线**（负面清单）：不做导购 / 电商、不做成分百科、不做社交、不加账号体系、不偏离「用香决策 + 传播」主线。这些即使实现得优雅，也不会被合并。现行范围与后置项见[产品方案](../docs/氛寸-产品方案.md)。
- **本节自身也可以通过 PR 修改**。

## 授权声明

除文件另有许可标注外，提交贡献即表示你同意：你的贡献按本项目的 **AGPL-3.0-only** 及 [LICENSE](../LICENSE) 中的第 7 条附加条款授权发布。

## 行为准则

参与本项目即视为同意遵守[行为准则](CODE_OF_CONDUCT.md)。
