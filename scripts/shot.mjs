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
  { name: "journal", route: "/journal", theme: "day", date: "2026-07-07T14:30:00", weather: CLOUDY, seed: "journal" },
  { name: "profile", route: "/profile", theme: "day", date: "2026-07-07T14:30:00", weather: CLOUDY },
  // 排版压测（非 README）：最长问候 + 看是否换行/被省略号截断/挤温度
  { name: "stress-long", route: "/", theme: "day", date: "2026-01-07T08:30:00", weather: COLD },
  // 最坏情况：9 字问候「细雨绵绵，记得带伞」+ 双字天气 + 两位数温度「小雨 · 18°」
  { name: "stress-rain", route: "/", theme: "day", date: "2026-04-07T14:00:00", weather: { tempC: 18, humidity: 72, windSpeed: 15, text: "小雨", city: "北京" } },
];

// withJournal：香历截图专属种子——七月上旬的穿香记录（色点=主香调族群）+ 今日快照
// （含「刚好」反馈与一句话手记）。只给 journal 目标用：那条 07-07 的反馈会让今日页的
// 反馈栏进入「已记过」态，混进公共种子会污染 today-* 截图。
const seedScript = (withJournal) => `(async () => {
  try {
    const all = await (await fetch('/data/perfumes.min.json')).json();
    const want = ['Aventus','Sauvage','Black Opium','Wild Bluebell','Tobacco Vanille','Light Blue'];
    const id = {}, zh = {};
    for (const w of want) { const p = all.find(x => x.name === w); if (p) { id[w] = p.id; zh[w] = p.nameZh || p.name; } }
    const now = 1782800000000, D = 8.64e7;
    const userPerfumes = Object.entries(id).map(([n, pid], i) => ({
      perfumeId: pid,
      addedAt: n === 'Wild Bluebell' ? now - 40*D : now - i*D,  // 蓝风铃入柜40天没碰 → 吃灰
    }));
    const tv = id['Tobacco Vanille'];
    const feedbacks = tv ? [-3,-12,-22].map(d => ({ perfumeId: tv, at: now + d*D, context: { season: 'winter', daypart: 'night', tempC: 6, occasion: 'date' }, rating: 'perfect' })) : [];
    const state = { userPerfumes, feedbacks, city: '北京', occasion: 'commute' };
    ${
      withJournal
        ? `
    const wb = id['Wild Bluebell'];
    state.wearLog = [
      { d: '2026-07-01', perfumeId: id['Light Blue'], name: zh['Light Blue'], fam: 'citrus', occasion: 'commute', tempC: 31, weatherText: '晴', feel: 'hot_humid' },
      { d: '2026-07-02', perfumeId: id['Aventus'], name: zh['Aventus'], fam: 'fruity', occasion: 'work', tempC: 29, weatherText: '多云', feel: 'hot_humid' },
      { d: '2026-07-04', perfumeId: id['Sauvage'], name: zh['Sauvage'], fam: 'woody', occasion: 'casual', tempC: 27, weatherText: '阴', feel: 'mild' },
      { d: '2026-07-06', perfumeId: tv, name: zh['Tobacco Vanille'], fam: 'sweet', occasion: 'date', tempC: 24, weatherText: '小雨', feel: 'mild' },
      { d: '2026-07-07', perfumeId: wb, name: zh['Wild Bluebell'], fam: 'floral', occasion: 'commute', tempC: 22, weatherText: '多云', feel: 'mild', note: '梅雨初歇，把它翻出来了——同事问了是什么香。' },
    ];
    state.feedbacks = [...feedbacks, { perfumeId: wb, at: new Date('2026-07-07T10:00:00').getTime(), context: { season: 'summer', daypart: 'day', tempC: 22, occasion: 'commute' }, rating: 'perfect' }];
    `
        : ""
    }
    localStorage.setItem('fencun-store', JSON.stringify({ state, version: 0 }));
    return userPerfumes.length;
  } catch(e) { return 'seed-fail:'+e.message; }
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
    await page.evaluate(seedScript(t.seed === "journal"));
    // networkidle2 会等天气 fetch 落地（避免截到「没拿到你的位置」中间态）；
    // 但 DeepSeek /api/explain 偶发挂起会让它超时——用 try/catch 兜住，天气此时早已加载，继续走后续显式等待。
    try {
      await page.goto(BASE + t.route, { waitUntil: "networkidle2", timeout: 20000 });
    } catch {}

    // 今日页：确保天气已渲染。定位/rehydrate 偶发竞态会让页面短暂停在「没拿到你的位置」，
    // 且此时 networkidle2 可能因暂无网络活动而提前判定空闲。轮询等温度出现；卡住就 reload 重试
    //（localStorage 已有城市，reload 后 rehydrate 必定读到 → fetchByCity → mock 天气）。
    if (t.route === "/") {
      let wok = false;
      for (let attempt = 0; attempt < 4 && !wok; attempt++) {
        try {
          await page.waitForFunction(
            () => !document.body.innerText.includes("没拿到你的位置") && /\d°/.test(document.body.innerText),
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
