# 安全政策

> English version: [SECURITY_EN.md](SECURITY_EN.md)

## 支持范围

氛寸持续部署，仅维护 `main` 分支和线上最新版本。

范围内：本仓库代码、API 路由和构建产物。

范围外：DeepSeek、和风天气、Vercel 等第三方服务本身的漏洞，以及针对线上站点的拒绝服务或压力测试。第三方漏洞请报告给对应厂商。

## 报告漏洞

请勿创建公开 Issue。使用以下任一私密渠道：

1. 仓库 **Security → Report a vulnerability** 中的 GitHub 私密漏洞报告。
2. 通过维护者 [@MrBaoboer](https://github.com/MrBaoboer) GitHub 主页公开的邮箱联系，邮件标题以「氛寸安全」或 `FenCun security` 开头。

报告应尽量包含受影响的页面或接口、复现步骤、影响评估，以及可用的 PoC。请在修复发布前保留合理的协调披露时间。报告确认后，维护者会同步评估与修复计划；修复发布后可按报告者意愿署名致谢。

## 架构说明

- 香柜、香历和反馈保存在浏览器 `localStorage`，服务端没有持久化用户数据库。
- 和风天气与 DeepSeek 密钥只供服务端 Route Handler 使用，不发送到浏览器。
- `/api/context`、`/api/explain`、`/api/parse-intent` 均内置限流与降级；`/api/explain` 与 `/api/parse-intent` 另对输入长度设上限。

因此最值得先看的是：这三条代理路由的滥用与注入面、任何可能泄露服务端密钥的路径，以及依赖链与构建产物。
