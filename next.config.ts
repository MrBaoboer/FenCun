// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // 全站安全响应头。
        // 说明：**script-src 待 nonce 方案**——Next.js 的运行时 inline 脚本与主题切换
        // 内联脚本会被非 nonce/hash 的严格策略误伤，而放宽到 'unsafe-inline' 的
        // script-src 防护价值有限，误伤风险大于收益。
        // 但那条理由只对 script-src 成立，下面这四条与内联脚本毫无关系，是零误伤的白拿：
        // base-uri 挡 <base> 劫持全站相对路径与表单目标、form-action 限制表单提交去向、
        // object-src 关掉 <object>/<embed>、frame-ancestors 与 X-Frame-Options 同义但更现代。
        // 这个应用把香柜、香历与手记全存在浏览器 localStorage 里，一旦有脚本执行就是
        // 全量本地数据外泄——纵深防御这一层的价值不是零。
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: "base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
          },
          // 产品依赖浏览器定位（navigator.geolocation），geolocation 必须允许 self，
          // 不能一刀切 geolocation=()。
          { key: "Permissions-Policy", value: "geolocation=(self)" },
        ],
      },
      {
        // public/data 下的 JSON 会随构建更新且路径不带版本号，不能 immutable；
        // 1 小时新鲜 + 24 小时 stale-while-revalidate，兼顾更新可见性与命中率。
        source: "/data/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
