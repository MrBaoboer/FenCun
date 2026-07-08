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

export const metadata: Metadata = {
  title: "氛寸 · 帮你用好香水",
  description:
    "氛寸（Fēn Cùn）——基于实时天气、体感与场合，从你已有的香水里告诉你今天该喷哪一瓶、怎么喷得恰到好处。",
  applicationName: "氛寸",
};

export const viewport: Viewport = {
  // 应用主题按时段/localStorage 切（见 body 内联脚本与 AppProvider），不跟 prefers-color-scheme——
  // 这里只给一个静态默认值，避免两套口径相撞；真实值由内联脚本/AppProvider 按 data-theme 同步
  themeColor: "#f3f0e8",
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
            __html: `(function(){try{var s=localStorage.getItem('fencun-theme');var h=new Date().getHours();var t=s||((h>=6&&h<18)?'day':'night');document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='night'?'#16130e':'#f3f0e8');}catch(e){}})();`,
          }}
        />
        <AppProvider>
          <SiteChrome>{children}</SiteChrome>
        </AppProvider>
      </body>
    </html>
  );
}
