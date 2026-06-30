import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/components/AppProvider";
import { SiteChrome } from "@/components/SiteChrome";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "氛寸 · 今天，刚好吗",
  description:
    "氛寸（Fēn Cùn）——基于实时天气、体感与场合，从你已有的香水里告诉你今天该喷哪一瓶、怎么喷得恰到好处。",
  applicationName: "氛寸",
};

export const viewport: Viewport = {
  themeColor: "#f6f3ee",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={`${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full">
        <AppProvider>
          <SiteChrome>{children}</SiteChrome>
        </AppProvider>
      </body>
    </html>
  );
}
