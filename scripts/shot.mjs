// 氛寸 · 可复用截图（系统 Chrome 无头）
// 能 mock 天气 + 冻结时间：既用来展示最文艺的问候（云淡风轻 / 云影入夜），
// 也用来压测最长文案是否换行 / 挤温度。产出到 .scratch/shots/。
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

// 温和多云的北京 → 昼「云淡风轻」/ 夜「云影入夜」（最文艺的展示态）
const CLOUDY = { tempC: 22, humidity: 52, windSpeed: 12, text: "多云", city: "北京" };
// 严寒晴天的北京 → 触发最长的问候「凉意渐起，添件外套」，用于压测排版
const COLD = { tempC: 5, humidity: 40, windSpeed: 20, text: "晴", city: "北京" };

const targets = [
  { name: "today-day", route: "/", theme: "day", date: "2026-07-07T14:30:00", weather: CLOUDY },
  { name: "today-night-2", route: "/", theme: "night", date: "2026-07-07T22:30:00", weather: CLOUDY },
  { name: "library", route: "/library", theme: "day", date: "2026-07-07T14:30:00", weather: CLOUDY },
  { name: "journal", route: "/journal", theme: "day", date: "2026-07-07T14:30:00", weather: CLOUDY },
  { name: "profile", route: "/profile", theme: "day", date: "2026-07-07T14:30:00", weather: CLOUDY },
  // 排版压测（非 README）：最长问候 + 看是否换行/被省略号截断/挤温度
  { name: "stress-long", route: "/", theme: "day", date: "2026-01-07T08:30:00", weather: COLD },
  // 最坏情况：9 字问候「细雨绵绵，记得带伞」+ 双字天气 + 两位数温度「小雨 · 18°」
  { name: "stress-rain", route: "/", theme: "day", date: "2026-04-07T14:00:00", weather: { tempC: 18, humidity: 72, windSpeed: 15, text: "小雨", city: "北京" } },
];

// 种子 = 演示香柜本身。
//
// 这里曾经维护着**第二套**手写种子（六瓶名字、吃灰天数、常喷计数、香历条目全都另写一遍），
// 于是 README 的门面图和初次到访者真正看到的东西是两份数据，改了一处就会悄悄漂移。
// 现在只清空 localStorage，让 AppProvider 按 lib/demo.ts 自动装载——
// 截图拍到的，逐字就是面试官点开链接看到的那一屏。
//
// 时间已被下方的 MockDate 冻结，而演示数据全部相对 Date.now() 生成，所以这仍然是确定性的。
const seedScript = `(async () => {
  try { localStorage.clear(); return 'cleared'; } catch(e) { return 'seed-fail:'+e.message; }
})()`;

// 只截某一屏（保住其它已满意的图）：SHOT_ONLY=today-night-2 node scripts/shot.mjs
const only = process.env.SHOT_ONLY;
const runTargets = only ? targets.filter((t) => t.name === only) : targets;

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
  defaultViewport: { width: 420, height: 920, deviceScaleFactor: 2 },
});

try {
  for (const t of runTargets) {
    const page = await browser.newPage();
    await page.setCacheEnabled(false);

    // 冻结时间 → 决定 daypart / season（让"白天"截图真的是白天问候，"夜"是夜问候）
    await page.evaluateOnNewDocument((iso) => {
      const F = new Date(iso).getTime();
      const R = Date;
      class MockDate extends R {
        constructor(...a) {
          if (a.length === 0) super(F);
          else super(...a);
        }
      }
      MockDate.now = () => F;
      window.Date = MockDate;
    }, t.date);

    // mock 天气：拦截 /api/context 返回固定天气，精确控制问候
    if (t.weather) {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        if (req.url().includes("/api/context")) {
          req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(t.weather) });
        } else {
          req.continue();
        }
      });
    }

    // 先到根页种数据，再进目标路由（第二次导航时 localStorage 已就绪）
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.evaluate(seedScript);
    // 演示香柜由应用在 rehydrate 后装载，需要一次导航才能生效
    // networkidle2 会等天气 fetch 落地（避免截到「没拿到你的位置」中间态）；
    // 但 DeepSeek /api/explain 偶发挂起会让它超时——用 try/catch 兜住，天气此时早已加载，继续走后续显式等待。
    try {
      await page.goto(BASE + t.route, { waitUntil: "networkidle2", timeout: 20000 });
    } catch {}

    // 今日页：确保天气已渲染。定位/rehydrate 偶发竞态会让页面短暂停在「没拿到你的位置」，
    // 且此时 networkidle2 可能因暂无网络活动而提前判定空闲。轮询等温度出现；卡住就 reload 重试
    //（localStorage 已有城市，reload 后 rehydrate 必定读到 → fetchByCity → mock 天气）。
    // 日期一并等：ContextBar 的日期是挂载后才求值的（首帧空串），只等温度会截到缺日期的一帧。
    if (t.route === "/") {
      let wok = false;
      for (let attempt = 0; attempt < 4 && !wok; attempt++) {
        try {
          await page.waitForFunction(
            () =>
              !document.body.innerText.includes("没拿到你的位置") &&
              /\d°/.test(document.body.innerText) &&
              /\d+月\d+日/.test(document.body.innerText),
            { timeout: 7000, polling: 300 }
          );
          wok = true;
        } catch {
          await page.reload({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
        }
      }
      if (!wok) console.warn(`⚠ ${t.name}: 天气始终未渲染，可能截到无天气态`);
    }

    await page.evaluate((theme) => {
      document.body.style.transition = "none";
      if (theme !== "auto") document.documentElement.dataset.theme = theme;
      // 隐藏移动端悬浮胶囊底栏(position:fixed)，否则 fullPage 截图里它会压在正文中间
      document.querySelectorAll("nav.fixed").forEach((el) => {
        el.style.display = "none";
      });
    }, t.theme);

    try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch {}
    // 等 DeepSeek 解读落定：今日页 loading 眉标「斟酌措辞…」消失才截；其它页立即通过。最多 12s
    try {
      await page.waitForFunction(() => !document.body.innerText.includes("斟酌措辞"), { timeout: 12000, polling: 400 });
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));

    const out = path.join(OUT_DIR, `${t.name}.png`);
    await page.screenshot({ path: out, fullPage: true });
    const kb = (fs.statSync(out).size / 1024).toFixed(0);
    console.log(`✓ ${t.name.padEnd(12)} → .scratch/shots/${t.name}.png (${kb} KB)`);
    await page.close();
  }
} finally {
  await browser.close();
}
