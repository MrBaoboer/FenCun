# 贡献指南

> English version: [CONTRIBUTING_EN.md](CONTRIBUTING_EN.md)

感谢你愿意为 **氛寸 / FenCun** 出一份力。

## 这个项目欢迎什么

- 🐛 Bug 修复与边界情况加固
- 🌡️ 规则引擎的准确性改进（打分 / 用法 / 用香裁决），**须附诊断或测试**
- 🈶 香名 / 香调中文映射的补全与纠正
- 📝 文档、文案、可访问性与国际化改进
- ✨ 与产品定位一致的新能力（请先开 Issue 对齐）

**不太合适的**：见下文「四条戒律」与「治理」的负面清单。

## 动手前：四条戒律（硬约束）

任何贡献都必须守住这四条：

1. **不伪精确** —— 留香 / 喷量 / 社交距离只给区间与档位，绝不给「6.2 小时」这类无法验证的假数字。
2. **不过度设计** —— 不上向量库、不引重后端；规则引擎在浏览器本地毫秒出结果。
3. **轻冷启动** —— 不逼用户先填问卷；搜名秒加即可用。
4. **有反馈闭环** —— 新增的推荐 / 判断应当可评价、可修正。

## 架构须知

- **决策权在规则引擎，表达权在 LLM。** 匹配打分、喷量 / 距离 / 留香判定必须是确定性规则（可解释、可复现、可单测）；DeepSeek 只负责听懂自然语言场景、把规则算好的事实翻成人话。
- **天气永远来自和风天气 API，绝不让 LLM 编造。**
- **优雅降级优先。** LLM 超时、定位失败都要有兜底，产品不白屏。

## 本地开发

```bash
git clone https://github.com/MrBaoboer/FenCun.git
cd FenCun
npm install
cp .env.example .env.local   # 填入你自己的和风天气 / DeepSeek key
npm run dev                  # http://localhost:3000
```

目录导航见 [README 的「目录结构」](../README.md#目录结构)。

## 提交前自检

```bash
npm run lint    # 代码风格
npm test        # 引擎 / 香历 / 搜索单测：改了 scoring / usage / recommend / journal / 搜索逻辑必须让它过，并补相应用例
npm run build   # 确保能构建
```

## 提交规范

- 采用 [Conventional Commits](https://www.conventionalcommits.org/)：`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `polish:` 等。正文写中文完全 OK，与现有历史一致。
- 请对提交做 **DCO 签名**（轻量，无需签署 CLA）：

  ```bash
  git commit -s -m "fix: ……"
  ```

  `-s` 会附上 `Signed-off-by`，表示你按 [Developer Certificate of Origin](https://developercertificate.org/) 声明自己有权提交这份代码。

## Pull Request 流程

1. 从 `main` 开分支，保持提交聚焦、可回溯。
2. 在 PR 描述里写清楚**动机**与**验证方式**；改了引擎的，请附上前后对比或测试。
3. 目标分支为 `main`；CI / 构建须通过。
4. 维护者会尽快审阅。

## 治理 / Governance

- **谁说了算**：氛寸由 [@MrBaoboer](https://github.com/MrBaoboer) 单人维护。维护者掌握产品边界、部署节奏、域名与合并权，可关闭越界、风险过高或验证不足的 PR。
- **什么不进主线**（负面清单）：不做导购 / 电商、不做成分百科、不做社交、不加账号体系、不偏离「用香决策 + 传播」主线。这些即使实现得优雅，也不会被合并；另见上文的四条戒律与架构须知。
- **本节自身也可以通过 PR 修改**。若未来引入长期协作者，会先更新本节、写清职责与交接，再授予权限。

## 授权声明

提交贡献即表示你同意：你的贡献以本项目的 **AGPL-3.0-only** 许可证授权发布。

## 行为准则

参与本项目即视为同意遵守[行为准则](CODE_OF_CONDUCT.md)。
