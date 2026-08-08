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
//   ③ 演示态的身份与一键清空放在「我的 · 数据」那一栏（见 app/profile/page.tsx）。
//      刻意**不**做全站常驻横幅——那对初次到访的人是打扰，理由写在 SiteNotice.tsx 顶部。
import type { Perfume, UserPerfume, Feedback, WearEntry, Season, Feel, Occasion } from "./types";
import { dateKey, dominantFamily } from "./journal";
import { seasonFromDateTemp } from "./season";

const DAY_MS = 24 * 3600 * 1000;

/** 演示态预设城市：直接跳过定位授权弹窗，进门就有真实天气可算。 */
export const DEMO_CITY = "北京";

/**
 * 六瓶的取法：覆盖清爽柑橘 / 果香木质 / 清新辛香 / 甜厚东方 / 粉感花香 五种气质，
 * 让「今日之选 → 备选对比 → 换一瓶」这条主路径在任何季节都有真实的取舍可看。
 * 六瓶本身与季节无关；随季节换的是它们各自扮演的角色（见下方 DemoScript）。
 */
const DEMO_BOTTLES: { name: string; ownedDays: number }[] = [
  { name: "Tobacco Vanille", ownedDays: 420 }, // 汤姆·福特 · 甜厚东方，冬季主力
  { name: "Light Blue", ownedDays: 260 }, // 杜嘉班纳 · 柑橘清新，夏季通勤
  { name: "Aventus", ownedDays: 190 }, // 信仰 · 果香木质，日常百搭
  { name: "Sauvage", ownedDays: 150 }, // 迪奥 · 清新辛香，正式商务
  { name: "Black Opium", ownedDays: 95 }, // 圣罗兰 · 咖啡香草，夜场
  { name: "Wild Bluebell", ownedDays: 330 }, // 祖·玛珑 · 粉感花香
];

/**
 * 演示脚本 —— 一份排期决定演示态的全部叙事。
 *
 * **为什么要按季节分成两份。** 两张发现型钩子各有一条硬前提：
 *   · 吃灰卡要求「搁置超 21 天的那瓶今天判 good」（nudges.ts 的 verdict === "good" 筛子）；
 *   · 预警卡要求「wornCount 最高的那瓶今天判 avoid」（hp.verdict !== "avoid" 即提前返回）。
 * 单一排期把这两个角色钉死在蓝风铃（春夏花香）与烟草香草（冬香）身上，于是一入秋两条
 * 前提同时反转：蓝风铃反季进不了吃灰筛子，烟草香草当季只是 caution 不是 avoid。
 * 实测 7 个场合 × 365 天：9 月 1 日到次年 2 月 28 日共 181 天，两张卡一张都弹不出——
 * 而 README 那五张图冻结在 7 月 7 日，门面展示的正好是这半年看不到的东西。
 * 引擎判得没错，错在排期让前提必然落空；所以修在数据侧，不动引擎。
 *
 * 换季换的是角色不是瓶子：**你习惯性喷的那瓶今天不合适、你很久没碰的那瓶今天正好**——
 * 这个叙事在两季都成立，只是主角对调（夏天烟草香草常喷 / 蓝风铃吃灰，
 * 秋冬浅蓝常喷 / 黑鸦片吃灰）。习惯难改，本来就是产品要解决的那件事。
 *
 * wornCount 是跨年度的累计穿戴次数（不由 wearLog 推导），最高的那瓶即「你常喷的」，
 * 让预警卡走 basis='habit' 主线而非冷启动兜底形态。
 */
interface DemoScript {
  /** 英文名 → 累计穿戴次数。最高者唯一，否则预警卡的归因不稳定。 */
  wornCount: Record<string, number>;
  /** 穿香排期（距今天数 → 哪一瓶）：决定香历色点、各瓶 lastWornAt、以及谁在吃灰。 */
  wear: { daysAgo: number; name: string; occasion: Occasion; note?: string }[];
  /**
   * 反馈序列——产品唯一的真壁垒，演示态必须让它可见地在起作用。
   * 每条都必须在 wear 里有同瓶同日的对应条目，否则会出现「没穿却评价了」
   * （demo.test.ts 有断言守着）。同一瓶要凑够**两次**「太冲了」：
   * 单次会被时间衰减吃到 0.374，够不着画像页 0.4 的门槛，壁垒就成了隐形的。
   *
   * ⚠️ 这张表没有 sprays 字段——而 aggregateBias 沉淀「成功配置」的唯一入口就挂在
   * `f.sprays` 上，所以演示态**从来没有**产出过成功配置。补它属于另一件事
   * （会改动画像页、需重拍 profile 截图），按用户决定留到单独一轮；
   * 但注释先得说真话，否则下一个人会照着它去找一个不存在的东西。
   */
  feedback: { daysAgo: number; name: string; occasion: Occasion; rating: Feedback["rating"] }[];
}

/**
 * 春夏脚本。**与冻结在 2026-07-07 的那五张 README 截图逐字对应**——
 * 动它之前先想清楚要不要重拍（scripts/shot.mjs 的 SHOTS 写死了那个日期）。
 * 蓝风铃停在 34 天前是刻意的：越过 21 天的吃灰线，让「翻出来」这张卡必然出现。
 */
const WARM_SCRIPT: DemoScript = {
  wornCount: { "Tobacco Vanille": 9, "Light Blue": 6, Aventus: 5, Sauvage: 4, "Black Opium": 3, "Wild Bluebell": 1 },
  wear: [
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
  ],
  feedback: [
    { daysAgo: 15, name: "Tobacco Vanille", occasion: "date", rating: "perfect" },
    { daysAgo: 25, name: "Tobacco Vanille", occasion: "home", rating: "perfect" },
    // 黑鸦片两次「太冲了」：画像页会因此写出「有 1 瓶你反馈过偏冲」，下次推它时喷量收一档。
    { daysAgo: 19, name: "Black Opium", occasion: "social", rating: "too_strong" },
    { daysAgo: 5, name: "Black Opium", occasion: "date", rating: "too_strong" },
    { daysAgo: 8, name: "Sauvage", occasion: "formal", rating: "perfect" },
    { daysAgo: 2, name: "Light Blue", occasion: "commute", rating: "perfect" },
  ],
};

/**
 * 秋冬脚本。角色对调：浅蓝成了「夏天留下来的习惯」（当季判 avoid → 预警卡），
 * 黑鸦片停在 24 天前越过吃灰线且当季判 good（→ 吃灰卡）。
 * 蓝风铃仍搁置 34 天，但反季判 avoid，会被吃灰筛子自然滤掉——这正是它该有的行为。
 */
const COOL_SCRIPT: DemoScript = {
  wornCount: { "Light Blue": 9, "Tobacco Vanille": 6, Aventus: 5, Sauvage: 4, "Black Opium": 3, "Wild Bluebell": 1 },
  wear: [
    { daysAgo: 2, name: "Light Blue", occasion: "commute" },
    { daysAgo: 3, name: "Tobacco Vanille", occasion: "date" },
    { daysAgo: 5, name: "Aventus", occasion: "work" },
    { daysAgo: 6, name: "Light Blue", occasion: "casual" },
    { daysAgo: 8, name: "Sauvage", occasion: "formal", note: "见客户，收着喷的，散场时还在。" },
    { daysAgo: 10, name: "Light Blue", occasion: "commute" },
    { daysAgo: 12, name: "Tobacco Vanille", occasion: "home" },
    { daysAgo: 14, name: "Aventus", occasion: "casual" },
    { daysAgo: 16, name: "Light Blue", occasion: "work" },
    { daysAgo: 17, name: "Sauvage", occasion: "work" },
    { daysAgo: 20, name: "Light Blue", occasion: "commute" },
    { daysAgo: 24, name: "Black Opium", occasion: "date" },
    { daysAgo: 28, name: "Black Opium", occasion: "social" },
    { daysAgo: 34, name: "Wild Bluebell", occasion: "commute", note: "天凉前最后一次用它，同事问了是什么香。" },
  ],
  feedback: [
    // 烟草香草两次「太冲了」：当季主力最容易喷过头，也是壁垒在秋冬唯一看得见的形态。
    { daysAgo: 3, name: "Tobacco Vanille", occasion: "date", rating: "too_strong" },
    { daysAgo: 12, name: "Tobacco Vanille", occasion: "home", rating: "too_strong" },
    { daysAgo: 24, name: "Black Opium", occasion: "date", rating: "perfect" },
    { daysAgo: 8, name: "Sauvage", occasion: "formal", rating: "perfect" },
    { daysAgo: 2, name: "Light Blue", occasion: "commute", rating: "perfect" },
    { daysAgo: 14, name: "Aventus", occasion: "casual", rating: "perfect" },
  ],
};

/**
 * 选哪份脚本只看**日期**，不看气温——演示状态在 AppProvider / 画像页都由
 * `buildDemoState(catalog, Date.now())` 生成，那两处都还没有天气可用。
 * 于是 9 月里 ≥28℃ 的日子引擎会按 summer 判、而这里给的是秋冬脚本：
 * 此时预警卡仍哑（浅蓝在高温下判 good），但吃灰卡会落到蓝风铃身上照常弹出——
 * 比单一脚本下的两张全哑严格更好，这个残差是可接受的。
 */
function scriptFor(now: number): DemoScript {
  const season = seasonFromDateTemp(new Date(now), null);
  return season === "autumn" || season === "winter" ? COOL_SCRIPT : WARM_SCRIPT;
}

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

/**
 * 取样必须由**日期**决定，不能由数组下标决定。
 *
 * wearLog 与 feedbacks 是两个独立数组、各自 map，此前各拿自己的下标去取样本：
 * 同一天、同一瓶、同一场合的那一件事，在香历里是「通勤 · 31℃ · 晴」，
 * 切到「我的 · 用香记录」却写着 28℃——同一份门面数据给出两个互相矛盾的读数，
 * 而其中一个已经印进 README 引用的截图。26↔28、31↔26 还都跨了 tempBand 边界，
 * 于是「成功配置复用」这个卖点在演示态里的命中键也和香历对不上。
 *
 * 用 at/DAY_MS 做索引：同一个 at 必得同一个样本，两个数组自然对齐；
 * 而 at = now − daysAgo×DAY_MS，整除关系保证它仍然只由 now 决定（纯函数不变）。
 */
function sampleFor(at: number): { tempC: number; text: string; feel: Feel; season: Season } {
  const season = seasonFromDateTemp(new Date(at), null);
  const s = SEASON_SAMPLE[season];
  const i = Math.floor(at / DAY_MS);
  const tempC = s.temps[((i % s.temps.length) + s.temps.length) % s.temps.length];
  return {
    tempC,
    text: s.texts[((i % s.texts.length) + s.texts.length) % s.texts.length],
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
  const script = scriptFor(now);

  // 各瓶最近一次穿戴 = 排期里距今最近的那一条
  const lastWorn = new Map<string, number>();
  for (const w of script.wear) {
    const prev = lastWorn.get(w.name);
    if (prev == null || w.daysAgo < prev) lastWorn.set(w.name, w.daysAgo);
  }

  const userPerfumes: UserPerfume[] = bottles.map((b) => {
    const d = lastWorn.get(b.name);
    return {
      perfumeId: b.p!.id,
      addedAt: now - b.ownedDays * DAY_MS,
      ...(d != null ? { lastWornAt: now - d * DAY_MS } : {}),
      wornCount: script.wornCount[b.name],
    };
  });

  const wearLog: WearEntry[] = script.wear.map((w) => {
    const p = byName.get(w.name)!;
    const at = now - w.daysAgo * DAY_MS;
    const s = sampleFor(at);
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

  const feedbacks: Feedback[] = script.feedback.map((f) => {
    const p = byName.get(f.name)!;
    const at = now - f.daysAgo * DAY_MS;
    const s = sampleFor(at);
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
