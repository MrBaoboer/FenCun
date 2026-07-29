import type { MetadataRoute } from "next";

// 加到主屏后是 standalone 打开：氛寸是"出门前看一眼"的场景，从主屏一点直达比走浏览器顺手。
// 主题色与 globals.css 的 --color-paper 同值——三处硬编码（内联脚本 / viewport / 这里）
// 必须一起改，否则浏览器 chrome 的底色会和页面差一截。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "氛寸 · 帮你用好香水",
    short_name: "氛寸",
    description:
      "根据实时天气和出席场合，告诉你今天最适合喷哪瓶香水，以及怎样用得恰到好处。",
    lang: "zh-CN",
    start_url: "/",
    display: "standalone",
    background_color: "#f1eee7",
    theme_color: "#f1eee7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
