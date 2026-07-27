// 氛寸 · 分享卡片与应用图标的生成器
//
// 为什么要生成而不是手绘：卡片上的字体、配色、字距必须和站点本身**同源**，
// 否则分享出去的第一印象和点进来看到的是两套设计。做法是先把无头浏览器开到站点自己的页面上，
// 让它把 Noto Serif SC / Fraunces 和全部 CSS 变量都加载好，再就地替换 DOM 画卡片——
// 这样拿到的就是站点自己的排版，而不是另写一份近似的。
//
// 用法（必须先起生产服务器，理由同 shot.mjs：dev 会挂调试悬浮球）：
//   npm run build && npx next start -p 3100
//   SHOT_BASE=http://localhost:3100 node scripts/og.mjs
//
// 产出（提交进仓库，运行时零成本）：
//   public/og.png                 1200×630  分享卡片
//   public/icon-192.png           192×192   PWA 图标
//   public/icon-512.png           512×512   PWA 图标
//   public/icon-maskable-512.png  512×512   可裁切图标（安全区内留白，见下）
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "public");
const BASE = process.env.SHOT_BASE || "http://localhost:3100";

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error("找不到 Chrome/Edge");
  process.exit(1);
}

// 卡片正文：不写 slogan 式空话，直接把产品做的那件事摆出来——
// 一行定位 + 三个真实规格词（喷量/社交距离/留香），看图的人不点进来也知道这是什么。
const ogHtml = `
<div style="
  width:1200px;height:630px;box-sizing:border-box;
  background:var(--color-paper);
  padding:78px 88px;display:flex;flex-direction:column;justify-content:space-between;
  position:relative;overflow:hidden;">
  <div style="position:absolute;inset:0;border:1px solid var(--color-line);margin:26px;border-radius:20px;"></div>
  <div style="position:relative;">
    <!-- 直接写预组合的大写字形，不要靠 text-transform：uppercase 会把 ē 拆成 E + 组合长音符，
         而 Fraunces 的拉丁子集里没有这个组合的合成字形，大字号下会渲染成断开的「FEˉN」。 -->
    <div style="font-family:var(--font-display);font-size:22px;letter-spacing:.34em;
                color:var(--color-accent);font-weight:600;">FĒN&nbsp;CÙN</div>
    <div style="font-family:var(--font-serif);font-size:118px;font-weight:700;letter-spacing:.1em;
                color:var(--color-ink);line-height:1.05;margin-top:14px;">氛寸</div>
  </div>
  <div style="position:relative;">
    <div style="font-family:var(--font-serif);font-size:40px;font-weight:600;color:var(--color-ink-soft);
                line-height:1.55;">你选香水，氛寸管分寸</div>
    <div style="font-family:var(--font-serif);font-size:26px;color:var(--color-ink-faint);
                margin-top:16px;line-height:1.6;">
      从你已有的香水里，按此刻的天气、体感与场合，告诉你今天喷哪一瓶、怎么喷
    </div>
    <div style="display:flex;gap:14px;margin-top:34px;">
      ${["喷量", "社交距离", "留香", "场合", "风险"]
        .map(
          (t) => `<span style="font-family:var(--font-serif);font-size:23px;color:var(--color-ink-soft);
            border:1px solid var(--color-line-strong);border-radius:999px;padding:9px 22px;">${t}</span>`
        )
        .join("")}
    </div>
  </div>
</div>`;

// 图标：只留一个「氛」字。safeRatio 是可裁切图标的安全区——
// Android 会按最大 20% 的圆角/圆形裁掉边缘，字必须缩进来，否则会被啃掉一角。
const iconHtml = (size, safeRatio) => `
<div style="width:${size}px;height:${size}px;box-sizing:border-box;background:var(--color-paper);
            display:flex;align-items:center;justify-content:center;">
  <div style="width:${Math.round(size * safeRatio)}px;height:${Math.round(size * safeRatio)}px;
              display:flex;align-items:center;justify-content:center;
              font-family:var(--font-serif);font-weight:700;color:var(--color-ink);
              font-size:${Math.round(size * safeRatio * 0.86)}px;line-height:1;">氛</div>
</div>`;

const targets = [
  { name: "og.png", w: 1200, h: 630, html: ogHtml, scale: 1 },
  { name: "icon-192.png", w: 192, h: 192, html: iconHtml(192, 0.78), scale: 1 },
  { name: "icon-512.png", w: 512, h: 512, html: iconHtml(512, 0.78), scale: 1 },
  // 可裁切版把字再收一档（0.62），给 Android 的圆形遮罩留出余量
  { name: "icon-maskable-512.png", w: 512, h: 512, html: iconHtml(512, 0.62), scale: 1 },
];

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
});

try {
  for (const t of targets) {
    const page = await browser.newPage();
    await page.setViewport({ width: t.w, height: t.h, deviceScaleFactor: t.scale });
    // 先加载站点本身：拿到它的 CSS 变量与 @font-face
    await page.goto(BASE + "/", { waitUntil: "networkidle0" });
    // 强制日间主题——分享卡片不该跟着生成那一刻的时段变
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "day";
    });
    await page.evaluate((html) => {
      document.body.style.margin = "0";
      document.body.innerHTML = html;
    }, t.html);
    // 等字体真的可用，否则会截到 Fraunces/宋体的回退字形
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, t.name), type: "png" });
    console.log(`✓ public/${t.name}  ${t.w}×${t.h}`);
    await page.close();
  }
} finally {
  await browser.close();
}
