// 氛寸 · 可复用截图（绕过失效的 preview_screenshot MCP，用系统 Chrome 无头）
// 用法：
//   node scripts/shot.mjs                       # 默认截 4 屏(今日日/夜、香柜、我的)到 .scratch/
//   node scripts/shot.mjs / night out.png       # 单屏：路由 主题 输出名
// 依赖：puppeteer-core + 系统已装的 Chrome/Edge（不下载浏览器）
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, ".scratch", "shots");
const BASE = process.env.SHOT_BASE || "http://localhost:3000";

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

// 命令行单屏模式 or 默认多屏
const argv = process.argv.slice(2);
const targets = argv.length
  ? [{ name: (argv[2] || "shot").replace(/\.png$/, ""), route: argv[0] || "/", theme: argv[1] || "day" }]
  : [
      { name: "today-day", route: "/", theme: "day" },
      { name: "today-night", route: "/", theme: "night" },
      { name: "library", route: "/library", theme: "day" },
      { name: "profile", route: "/profile", theme: "day" },
    ];

const SEED = `(async () => {
  try {
    const all = await (await fetch('/data/perfumes.min.json')).json();
    const want = ['Aventus','Sauvage','Black Opium','Wild Bluebell','Tobacco Vanille','Light Blue'];
    const id = {};
    for (const w of want) { const p = all.find(x => x.name === w); if (p) id[w] = p.id; }
    const now = 1782800000000, D = 8.64e7;
    const userPerfumes = Object.entries(id).map(([n, pid], i) => ({
      perfumeId: pid,
      addedAt: n === 'Wild Bluebell' ? now - 40*D : now - i*D,  // 蓝风铃入柜40天没碰 → 吃灰
    }));
    // 烟草香草被喷过3次 → 常用香（夏天不合适，触发天气突变预警）
    const tv = id['Tobacco Vanille'];
    const feedbacks = tv ? [-3,-12,-22].map(d => ({ perfumeId: tv, at: now + d*D, context: { season: 'winter', daypart: 'night', tempC: 6, occasion: 'date' }, rating: 'perfect' })) : [];
    localStorage.setItem('fencun-store', JSON.stringify({ state: { userPerfumes, feedbacks, city: '上海', occasion: 'commute' }, version: 0 }));
    return userPerfumes.length;
  } catch(e) { return 'seed-fail:'+e.message; }
})()`;

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
  defaultViewport: { width: 420, height: 920, deviceScaleFactor: 2 },
});

try {
  const page = await browser.newPage();
  await page.setCacheEnabled(false); // 防止截到浏览器缓存的旧 CSS
  // 注意：dev server 若在 git 回退/大改后没热更新，可能吐旧编译产物 —— 截图前最好重启 dev（见 README）
  // 先到同源根页种数据（domcontentloaded 即可，不等完整加载）
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const seeded = await page.evaluate(SEED);
  console.log("种入香柜:", seeded, "瓶");

  for (const t of targets) {
    await page.goto(BASE + t.route, { waitUntil: "networkidle2", timeout: 30000 });
    // 强制主题 + 关掉过渡，避免截到中间态
    await page.evaluate((theme) => {
      document.body.style.transition = "none";
      if (theme !== "auto") document.documentElement.dataset.theme = theme;
    }, t.theme);
    // 等字体与 DeepSeek 解读落定
    try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch {}
    await new Promise((r) => setTimeout(r, 3500));
    const out = path.join(OUT_DIR, `${t.name}.png`);
    await page.screenshot({ path: out, fullPage: true });
    const kb = (fs.statSync(out).size / 1024).toFixed(0);
    console.log(`✓ ${t.name.padEnd(12)} → .scratch/shots/${t.name}.png (${kb} KB)`);
  }
} finally {
  await browser.close();
}
