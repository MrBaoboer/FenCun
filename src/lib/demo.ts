// 演示香柜（黄金集）——纯函数层，无副作用、无随机、无 Date.now()：给定 now 必得同一份状态。
//
// 为什么需要它：氛寸的第一屏是「你的香柜」，而空柜什么也算不出来。
// 初次到访的人看到的是一句邀请，不是产品——推荐、备选对比、预警、香历、画像全部要等他
// 先手动录入几瓶香水才会出现。演示香柜把这段空白填上：进门即是满配。
//
// 三条自我约束，避免演示变成假货：
//   ① 六瓶全部取自主目录高票段（最低 5484 人评价），演示态里每一句判断都由真实社区数据算出，
//      没有一个编造的数字——这与「反伪精确」是同一条纪律，不因为是演示就松口；
//   ② 时间全部相对于打开的那一刻生成（而非写死时间戳），所以无论谁在哪一天打开，
//      「搁置 34 天」「上次是三天前」都是当天算出来的真话，香历也永远落在最近这几周；
//   ③ 演示态在界面上始终自报身份，且一键可清空（见 DemoBanner）。
import type { Perfume, UserPerfume, Feedback, WearEntry, Season, Feel, Occasion } from "./types";
import { dateKey, dominantFamily } from "./journal";
import { seasonFromDateTemp } from "./season";

const DAY_MS = 24 * 3600 * 1000;

/** 演示态预设城市：直接跳过定位授权弹窗，进门就有真实天气可算。 */
export const DEMO_CITY = "北京";

/**
 * 六瓶的取法：覆盖清爽柑橘 / 果香木质 / 清新辛香 / 甜厚东方 / 粉感花香 五种气质，
 * 让「今日之选 → 备选对比 → 换一瓶」这条主路径在任何季节都有真实的取舍可看。
 * wornCount 是跨年度的累计穿戴次数（不由 wearLog 推导）——烟草香草最高，于是它是
 * 「你常喷的那瓶」，天气突变预警在热天走 basis='habit' 主线而非冷启动兜底形态。
 */
const DEMO_BOTTLES: { name: string; ownedDays: number; wornCount: number }[] = [
  { name: "Tobacco Vanille", ownedDays: 420, wornCount: 9 }, // 汤姆·福特 · 甜厚东方，冬季主力
  { name: "Light Blue", ownedDays: 260, wornCount: 6 }, // 杜嘉班纳 · 柑橘清新，夏季通勤
  { name: "Aventus", ownedDays: 190, wornCount: 5 }, // 信仰 · 果香木质，日常百搭
  { name: "Sauvage", ownedDays: 150, wornCount: 4 }, // 迪奥 · 清新辛香，正式商务
  { name: "Black Opium", ownedDays: 95, wornCount: 3 }, // 圣罗兰 · 咖啡香草，夜场
  { name: "Wild Bluebell", ownedDays: 330, wornCount: 1 }, // 祖·玛珑 · 粉感花香，久未开封 → 吃灰提醒
];

/**
 * 穿香排期（距今天数 → 哪一瓶）。它同时决定三件事：香历色点、各瓶的 lastWornAt、以及谁在吃灰。
 * 蓝风铃停在 34 天前是刻意的：越过 21 天的吃灰线，让「翻出来」这张卡在演示里必然出现。
 */
const WEAR_SCHEDULE: { daysAgo: number; name: string; occasion: Occasion; note?: string }[] = [
  { daysAgo: 2, name: "Light Blue", occasion: "commute" },
  { daysAgo: 4, name: "Aventus", occasion: "work" },
  { daysAgo: 5, name: "Black Opium", occasion: "date" },
  { daysAgo: 6, name: "Light Blue", occasion: "casual" },
  { daysAgo: 8, name: "Sauvage", occasion: "formal", note: "见客户，收着喷的，散场时还在。" },
  { daysAgo: 10, name: "Aventus", occasion: "work" },
  { daysAgo: 12, name: "Light Blue", occasion: "commute" },
  { daysAgo: 15, name: "Tobacco Vanille", occasion: "date" },
  { daysAgo: 17, name: "Sauvage", occasion: "work" },
  { daysAgo: 19, name: "Black Opium", occasion: "social" },
  { daysAgo: 22, name: "Aventus", occasion: "casual" },
  { daysAgo: 25, name: "Tobacco Vanille", occasion: "home" },
  { daysAgo: 28, name: "Black Opium", occasion: "date" },
  { daysAgo: 34, name: "Wild Bluebell", occasion: "commute", note: "梅雨初歇翻出来的，同事问了是什么香。" },
];

/**
 * 反馈序列——产品唯一的真壁垒，演示态必须让它可见地在起作用：
 * 烟草香草三次「刚好」会沉淀成成功配置，黑鸦片一次「太冲了」会让它下次的喷量自动收一档。
 */
const FEEDBACK_SCHEDULE: { daysAgo: number; name: string; occasion: Occasion; rating: Feedback["rating"] }[] = [
  { daysAgo: 15, name: "Tobacco Vanille", occasion: "date", rating: "perfect" },
  { daysAgo: 25, name: "Tobacco Vanille", occasion: "home", rating: "perfect" },
  // 同一瓶两次「太冲了」——这是产品唯一的真壁垒在演示里唯一看得见的形态：
  // 画像页会因此写出「有 1 瓶你反馈过偏冲」，下次推它时喷量与扩散各自收一档。
  // 单独一次会被时间衰减吃到 0.374，够不着画像页 0.4 的门槛，于是壁垒在演示里是隐形的。
  { daysAgo: 19, name: "Black Opium", occasion: "social", rating: "too_strong" },
  { daysAgo: 5, name: "Black Opium", occasion: "date", rating: "too_strong" },
  { daysAgo: 8, name: "Sauvage", occasion: "formal", rating: "perfect" },
  { daysAgo: 2, name: "Light Blue", occasion: "commute", rating: "perfect" },
];

/**
 * 香历条目要写进当天的温度与天气。演示不联网取历史天气（那既慢又要额外配额），
 * 改用按季节的代表读数——**这是估算，所以它只出现在演示数据里**，
 * 真实穿戴记录一律来自当天接口返回的实测值（见 journal.ts:wearEntryFrom）。
 */
const SEASON_SAMPLE: Record<Season, { temps: number[]; texts: string[]; feel: Feel }> = {
  spring: { temps: [17, 20, 15, 22], texts: ["多云", "晴", "阴", "小雨"], feel: "mild" },
  summer: { temps: [31, 28, 33, 26], texts: ["晴", "多云", "晴", "雷阵雨"], feel: "hot_dry" },
  autumn: { temps: [19, 16, 22, 13], texts: ["晴", "多云", "阴", "小雨"], feel: "mild" },
  winter: { temps: [3, -1, 6, 1], texts: ["晴", "阴", "多云", "小雪"], feel: "cold" },
};

function sampleFor(date: Date, i: number): { tempC: number; text: string; feel: Feel; season: Season } {
  const season = seasonFromDateTemp(date, null);
  const s = SEASON_SAMPLE[season];
  const tempC = s.temps[i % s.temps.length];
  return {
    tempC,
    text: s.texts[i % s.texts.length],
    // feel 由代表温度真实推出，而不是照抄季节默认——否则 26℃ 的夏日会被标成干热
    feel: tempC >= 28 ? "hot_dry" : tempC <= 10 ? "cold" : "mild",
    season,
  };
}

export interface DemoState {
  userPerfumes: UserPerfume[];
  feedbacks: Feedback[];
  wearLog: WearEntry[];
  city: string;
  occasion: Occasion;
}

/** 演示香柜依赖的六瓶是否都在目录里（目录尚未加载完 / 数据缺失时返回 false） */
export function demoBottlesReady(catalog: Perfume[] | null): boolean {
  if (!catalog) return false;
  const names = new Set(catalog.map((p) => p.name));
  return DEMO_BOTTLES.every((b) => names.has(b.name));
}

/**
 * 生成演示状态。纯函数：同一个 (catalog, now) 必得同一份结果，可单测、可用于截图脚本。
 * 六瓶缺任意一瓶即返回 null——宁可不进演示态，也不给一个残缺的香柜。
 */
export function buildDemoState(catalog: Perfume[] | null, now: number): DemoState | null {
  if (!catalog) return null;
  const byName = new Map(catalog.map((p) => [p.name, p]));
  const bottles = DEMO_BOTTLES.map((b) => ({ ...b, p: byName.get(b.name) }));
  if (bottles.some((b) => !b.p)) return null;

  // 各瓶最近一次穿戴 = 排期里距今最近的那一条
  const lastWorn = new Map<string, number>();
  for (const w of WEAR_SCHEDULE) {
    const prev = lastWorn.get(w.name);
    if (prev == null || w.daysAgo < prev) lastWorn.set(w.name, w.daysAgo);
  }

  const userPerfumes: UserPerfume[] = bottles.map((b) => {
    const d = lastWorn.get(b.name);
    return {
      perfumeId: b.p!.id,
      addedAt: now - b.ownedDays * DAY_MS,
      ...(d != null ? { lastWornAt: now - d * DAY_MS } : {}),
      wornCount: b.wornCount,
    };
  });

  const wearLog: WearEntry[] = WEAR_SCHEDULE.map((w, i) => {
    const p = byName.get(w.name)!;
    const at = now - w.daysAgo * DAY_MS;
    const s = sampleFor(new Date(at), i);
    return {
      d: dateKey(at),
      perfumeId: p.id,
      name: p.nameZh || p.name,
      fam: dominantFamily(p).key,
      occasion: w.occasion,
      tempC: s.tempC,
      weatherText: s.text,
      feel: s.feel,
      ...(w.note ? { note: w.note } : {}),
    };
  }).sort((a, b) => a.d.localeCompare(b.d));

  const feedbacks: Feedback[] = FEEDBACK_SCHEDULE.map((f, i) => {
    const p = byName.get(f.name)!;
    const at = now - f.daysAgo * DAY_MS;
    const s = sampleFor(new Date(at), i);
    return {
      perfumeId: p.id,
      at,
      context: {
        season: s.season,
        daypart: f.occasion === "date" || f.occasion === "social" ? ("night" as const) : ("day" as const),
        tempC: s.tempC,
        occasion: f.occasion,
        feel: s.feel,
      },
      rating: f.rating,
    };
  });

  return { userPerfumes, feedbacks, wearLog, city: DEMO_CITY, occasion: "commute" };
}
