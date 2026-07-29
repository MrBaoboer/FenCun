// 路由段的 layout 天然是 server component，可以导出 metadata，而 page.tsx 保持 "use client"。
// 四个页面此前共用根 layout 的 title 与 canonical："/"，于是浏览器标签页、书签、
// 分享卡片全是「氛寸 · 帮你用好香水」，分不清哪个是哪个；og:url 也写死首页，
// 把 /profile 分享出去点进来会落在首页。
//（三个内页确实没有独有的可索引内容——数据都在用户本机，服务端渲染出来的只有骨架，
//  见 sitemap.ts 的说明。所以这不是收录问题，是门面问题。）
import { pageMetadata } from "@/app/page-meta";

export const metadata = pageMetadata({
  title: "我的分寸 · 氛寸",
  description: "氛寸从你的反馈里学到的偏好，以及这台机器上存了什么。",
  path: "/profile",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
