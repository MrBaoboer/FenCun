import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // 全站安全响应头。
        // 说明：暂不上 CSP —— Next.js 的运行时 inline 脚本与主题切换内联脚本
        // 会被非 nonce/hash 的严格策略误伤，而放宽到 'unsafe-inline' 的 CSP
        // 防护价值有限，误伤风险大于收益；待引入 nonce 方案后再补。
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
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
