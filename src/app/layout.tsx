// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

import type { Metadata, Viewport } from "next";
import { Fraunces, Noto_Serif_SC } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/components/AppProvider";
import { SiteChrome } from "@/components/SiteChrome";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  style: ["normal", "italic"],
});

// 中文衬线主嗓音（自托管，构建期下载、不依赖 Google 运行时，规避国内墙）
//
// weight 用可变轴而不是列三档：Noto Serif SC 是可变字体（wght 200–900），列 500/600/700
// 并不会各下一份字体文件——next/font 对**同一批** 101 个 woff2 分片各发一遍 @font-face，
// 于是 304 条规则指向 101 个去重后的 URL，其中三分之二是重复声明。
// 那份 CSS 是渲染阻塞的：实测 98.2KB gzip → 收敛成一档后约 33KB。
const notoSerifSC = Noto_Serif_SC({
  weight: "variable",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-noto-serif-sc",
  preload: false,
});

// 站点根地址。Vercel 在预览部署里会给出不同的域名，所以优先读它注入的环境变量，
// 让预览环境的 OG 卡片指向自己而不是生产站；本地与生产都落回正式域名。
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL
  : process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://fencun.vercel.app";

const TITLE = "氛寸 · 帮你用好香水";
const DESCRIPTION =
  "氛寸（Fēn Cùn）——根据实时天气和出席场合，告诉你今天最适合喷哪瓶香水，以及怎样用得恰到好处。";

export const metadata: Metadata = {
  // metadataBase 必须给：没有它，openGraph.images 的相对路径不会被补成绝对 URL，
  // 而抓取方（微信、X、Slack）只认绝对地址——卡片会静默退化成没有图。
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "氛寸",
  keywords: ["香水", "用香建议", "喷量", "留香", "香调", "氛寸", "fragrance"],
  authors: [{ name: "MrBaoboer", url: "https://github.com/MrBaoboer" }],
  alternates: { canonical: "/" },
  // manifest 里配了三张自制图标，但 iOS 较老的系统在「添加到主屏幕」时只找
  // /apple-touch-icon.png 这个固定名字（新版 WebKit 已经会读 manifest）。
  // 图由 npm run og 生成，与 icon-192/512 同源同版式。
  //
  // ⚠️ 这里**不要**再写 icon: "/favicon.ico"。src/app/favicon.ico 是 Next 的文件约定，
  // 框架已经自动发一条带内容 hash 的 <link rel="icon" href="/favicon.ico?favicon.xxx.ico">；
  // 在这里重复声明只会多出一条**不带 hash** 的同名链接，而 /favicon.ico 恰恰是浏览器
  // 缓存最凶的一个路径——换了图标也照旧显示旧的。留框架那条，换图即换 URL。
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "氛寸", statusBarStyle: "default" },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: "氛寸",
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "氛寸 · 帮你用好香水" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  // 应用主题默认恒为明韵（浅色），只由用户手动切换改写（见 body 内联脚本与 ThemeToggle），
  // 既不按时段翻、也不跟 prefers-color-scheme。这里给的静态值就是默认主题的底色；
  // 用户切到暗香后，由 AppProvider 的 MutationObserver 把 theme-color 同步过去
  // 与 globals.css 的 --color-paper 同值。两处硬编码曾各走各的（#f3f0e8 / #16130e），
  // 于是浏览器 chrome 的底色和页面差一截，深色下尤其明显（暖棕黑 vs 中性墨黑）。
  themeColor: "#f1eee7",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh-CN"
      className={`${fraunces.variable} ${notoSerifSC.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* 主目录 JSON（gzip 约 266KB）是首屏推荐的必要输入，而它此前要等 CSS + JS +
            hydration 全跑完、AppProvider 挂载之后才被发现，白白串在关键路径末尾。
            放进服务端渲染的 <head> 里，浏览器一读到就能与 JS 并行开始下载。
            四页共用同一个 AppProvider，所以四页都需要它。 */}
        <link rel="preload" as="fetch" href="/data/perfumes.min.json" crossOrigin="anonymous" />
      </head>
      <body className="min-h-full">
        <script
          dangerouslySetInnerHTML={{
            // 首帧就把主题定死，避免刷新时先闪一下另一套配色。
            // 默认恒为「明韵」（浅色）：不按时段自动翻、也不读 prefers-color-scheme——
            // 主题是产品的固定面貌，而不是一个会自己变的环境读数。暗香只在用户亲手切过之后出现，
            // 那条偏好记在 localStorage 的 fencun-theme 里。
            __html: `(function(){try{var t=localStorage.getItem('fencun-theme')==='night'?'night':'day';document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='night'?'#131315':'#f1eee7');}catch(e){}})();`,
          }}
        />
        <AppProvider>
          <SiteChrome>{children}</SiteChrome>
        </AppProvider>
      </body>
    </html>
  );
}
