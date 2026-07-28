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
//   public/apple-touch-icon.png   180×180   iOS 添加到主屏幕
//   src/app/favicon.ico           16/32/48  浏览器标签页（Next 的文件约定，自动挂到 /favicon.ico）
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "public");
// favicon 不放 public/：Next 的文件约定要求它在 app/ 目录里，由框架自己挂到 /favicon.ico
// 并生成 <link rel="icon">。放进 public/ 会出现两份同名资源，谁赢取决于路由顺序。
const OUT_APP = path.join(ROOT, "src", "app");
const BASE = process.env.SHOT_BASE || "http://localhost:3100";

/**
 * 原始 RGBA 像素 → ICO 里的一个 BMP/DIB 条目。
 *
 * ICO 从 Vista 起也允许直接内嵌 PNG，但那条路走不通：Next 的图标解码器要求内嵌的 PNG
 * **必须是 RGBA**，而 Chrome 给不透明画面截图时会编码成不带 alpha 的 RGB，
 * 构建期直接报 `The PNG is not in RGBA format`。BMP 这条经典路径没有这个歧义，
 * 也正是原来那个默认 favicon 里 16/32/48 三档的存法。
 *
 * 结构：BITMAPINFOHEADER(40) + XOR 位图(BGRA，**自下而上**) + AND 掩码(1bpp，行补齐到 4 字节)。
 * 高度字段要写两倍——这是 ICO 的历史包袱：它把 XOR 与 AND 两张图当成一张来记。
 * 32 位色下 alpha 已经在 XOR 里，AND 掩码全 0（全不透明）即可，但**不能省**。
 */
function dibEntry(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight = XOR + AND
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression = BI_RGB
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4; // 自下而上
    const dst = y * size * 4;
    for (let x = 0; x < size; x++) {
      const s = src + x * 4;
      const d = dst + x * 4;
      xor[d] = rgba[s + 2]; // B
      xor[d + 1] = rgba[s + 1]; // G
      xor[d + 2] = rgba[s]; // R
      xor[d + 3] = rgba[s + 3]; // A
    }
  }
  // AND 掩码：1 = 透明。32 位色下现代渲染器只看 alpha，但老一些的（含 Windows 资源管理器）
  // 仍读这张掩码——圆角那四个角是真透明，掩码不跟着标就会在那些地方露出黑边。
  const maskRow = Math.ceil(size / 8 / 4) * 4;
  const mask = Buffer.alloc(maskRow * size);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4; // 与 XOR 同样自下而上
    for (let x = 0; x < size; x++) {
      if (rgba[src + x * 4 + 3] < 128) mask[y * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, xor, mask]);
}

/**
 * 把若干个 DIB 条目打成一个 .ico。零依赖——ICO 的容器格式就是一个定长目录加数据段。
 */
function packIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size; // 0 表示 256
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0; // 调色板颜色数：真彩色为 0
    dir[o + 3] = 0; // reserved
    dir.writeUInt16LE(1, o + 4); // color planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(e.buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.buf.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.buf)]);
}

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
    <!-- 与报头同口径：**不带声调**。「Ē」(U+0112) 属 Latin Extended-A，而 Fraunces 以
         subsets:["latin"] 引入、只发 Latin-1 那一片——document.fonts.check(Fraunces, "Ē")
         为 false，写进 DOM 也不会触发新的字体请求，所以那个字形只会落在回退字体上，
         与旁边真·Fraunces 的字母不同源。（此处原本的注释把成因写成"uppercase 会把 ē
         拆成 E + 组合长音符"，实测不成立：uppercase 给出的就是预组合的 Ē。）
         裸字母全部落在 Latin-1，分享卡片与站内报头也就是同一套字形。 -->
    <div style="font-family:var(--font-display);font-size:22px;letter-spacing:.34em;
                color:var(--color-accent);font-weight:600;">FEN&nbsp;CUN</div>
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

/**
 * favicon 单独一套画法：**圆角 + 字收小**。
 *
 * 与 PWA 图标分开而不是复用 iconHtml，是因为圆角只在这里成立——
 * Android 的 maskable 与 iOS 的主屏图标都会自己套遮罩，我们先圆一次等于圆两次。
 *
 * 圆角半径取 22%，是方形与胶囊之间那个还能看出是"一枚印记"的位置。
 * 角上因此透明，所以截图要 omitBackground，DIB 那边也据此写 AND 掩码。
 */
const faviconHtml = (size, ratio) => `
<div style="width:${size}px;height:${size}px;box-sizing:border-box;background:var(--color-paper);
            border-radius:${(size * 0.22).toFixed(2)}px;
            display:flex;align-items:center;justify-content:center;">
  <div style="font-family:var(--font-serif);font-weight:700;color:var(--color-ink);
              font-size:${Math.round(size * ratio)}px;line-height:1;
              transform:translateY(-0.09em);">氛</div>
</div>`;

// 三档尺寸。字号是**整块比例**，不再套一层安全区。
//
// 这个比例调过两轮：0.79 撑得太满、像个方块章；收到 0.52 又太小，32px 下笔画糊在一起
// 认不出是哪个字。落在 0.66 附近——把 32px 那一档放大六倍逐像素比过，
// 「氛」的撇捺能分开、四周还留得住一圈白，"一枚印记"的样子和认得出来两件事都成立。
// 16px 那一档单独再放宽：十二画的字在十六个像素里，按 32 的比例收就只剩一团墨；
// 而绝大多数显示器实际取的是 32 那一档。
//
// translateY(-0.09em)：flex 居中对齐的是**行盒**，不是字面。CJK 字面在 em 框里
// 本来就偏下，实测 32px 那一档的墨迹重心比格子中心低约 2px——小尺寸下这一点点偏移
// 看起来就是"没放正"。按字号比例补回去，三档一致。
const FAVICON_SIZES = [
  { size: 16, ratio: 0.72 },
  { size: 32, ratio: 0.66 },
  { size: 48, ratio: 0.64 },
];

const targets = [
  { name: "og.png", w: 1200, h: 630, html: ogHtml, scale: 1 },
  { name: "icon-192.png", w: 192, h: 192, html: iconHtml(192, 0.78), scale: 1 },
  { name: "icon-512.png", w: 512, h: 512, html: iconHtml(512, 0.78), scale: 1 },
  // 可裁切版把字再收一档（0.62），给 Android 的圆形遮罩留出余量
  { name: "icon-maskable-512.png", w: 512, h: 512, html: iconHtml(512, 0.62), scale: 1 },
  // iOS 的「添加到主屏幕」在较老的系统上不读 manifest 的 icons，只找这张固定名字的图。
  // 新版 WebKit 已经会读 manifest，所以这不是"全线失效"，只是"一部分设备上拿不到"——
  // 但补一张 180×180 的成本近乎为零，没理由让自制的「氛」字在那些机器上退化成截图缩略图。
  { name: "apple-touch-icon.png", w: 180, h: 180, html: iconHtml(180, 0.78), scale: 1 },
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

  // favicon：同一套画法渲染三个尺寸，再打成一个 .ico。
  // 仓库此前一直挂着 Next 脚手架自带的那个默认图标（黑底白三角），
  // 也就是说线上标签页从来没显示过这个产品自己的标记。
  const icoEntries = [];
  for (const { size, ratio } of FAVICON_SIZES) {
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.goto(BASE + "/", { waitUntil: "networkidle0" });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "day";
    });
    await page.evaluate((html) => {
      // 圆角之外要**真的**透明，而站点的底色有两层，光设 style.background 都摁不住：
      //   · body 有 `transition: background-color .5s`——设成 transparent 之后截图
      //     会落在过渡中途，角上拿到的是半透明（实测 alpha=190，不是 0）；
      //   · body::before 还铺着一层固定定位的光晕渐变，压根不受 background 影响。
      // 用一段带 !important 的样式一次性摁掉这两层，不依赖任何时序。
      const kill = document.createElement("style");
      kill.textContent =
        "html,body{background:transparent!important;transition:none!important}" +
        "body::before,body::after{display:none!important}";
      document.head.appendChild(kill);
      document.body.style.margin = "0";
      document.body.innerHTML = html;
    }, faviconHtml(size, ratio));
    await page.evaluate(() => document.fonts.ready);
    // 取**原始像素**而不是 PNG：截图回来的 PNG 色彩类型不由我们决定（见 dibEntry 的说明），
    // 而 canvas 的 getImageData 恒定给 RGBA。omitBackground 让四角保持透明。
    const b64 = await page.screenshot({ type: "png", encoding: "base64", omitBackground: true });
    const rgba = await page.evaluate(
      async (data, n) => {
        const img = new Image();
        img.src = "data:image/png;base64," + data;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = n;
        c.height = n;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(0, 0, n, n).data);
      },
      b64,
      size
    );
    icoEntries.push({ size, buf: dibEntry(rgba, size) });
    await page.close();
  }
  fs.writeFileSync(path.join(OUT_APP, "favicon.ico"), packIco(icoEntries));
  console.log(`✓ src/app/favicon.ico  ${FAVICON_SIZES.map((f) => f.size).join("/")}`);
} finally {
  await browser.close();
}
