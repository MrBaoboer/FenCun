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
const notoSerifSC = Noto_Serif_SC({
  weight: ["500", "600", "700"],
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
  "氛寸（Fēn Cùn）——基于实时天气、体感与场合，从你已有的香水里告诉你今天该喷哪一瓶、怎么喷得恰到好处。";

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
