// 规则打分引擎（确定性，可解释）—— 决策权在这里，LLM 不参与
import type { Perfume, Context, Feel, Season, Bias } from "./types";
import { OCCASION_WEIGHTS, FAMILY_DISCOUNT, LOUD_PENALTY } from "./occasion-priors";

function accStrength(p: Perfume, en: string): number {
  const a = p.accords.find((x) => x.en === en);
  return a ? a.strength : 0;
}

/**
 * 香调家族常量。**每个键都必须在数据集里真实存在**——否则规则永远静默空转。
 * 审计结果（对 1500 主目录 + 64 个扩展分片全量统计，共 90 种真实键）：
 *   resinous / sandalwood / cedar / watery / jasmine / 裸 spicy —— 出现 0 次，全是幽灵键。
 * 其中 resinous 的代价最大：它本该代表树脂香膏，而数据集里这个家族叫 `balsamic`（208 款），
 * 于是 208 款香膏调在热天不算厚重、在冷天也不算暖调，两条规则都白写。
 *
 * 甜（美食调）与琥珀（树脂膏香）**必须分开**：
 * 琥珀在调香学里属树脂/香膏家族（劳丹脂、安息香、苏合香），不是美食甜调。
 * 混为一谈的代价：主目录 112 款——蔚蓝浓香精(amber=86, sweet=0)、旷野、当蓝、
 * 绿爱尔兰花呢这种著名干绿木质——都会被告知"它偏甜重，上身久了容易发腻"。
 */
const F = {
  /**
   * 真·甜：美食调里**可靠地**指向"久了会发腻"的那一类。
   *
   * 刻意排除 cacao / coffee / almond / coconut ——它们是"美食调邻居"，但在调香里
   * 经常是干、苦、焙烤的质感，把它们算作甜会**复刻 amber 那个错误**。用本仓库真实数据点名：
   *   迪奥桀骜  iris=100 cacao=68 powdery=67 leather=50  → 鸢尾皮革，干苦可可粉
   *   大写檀香  woody=100 warm spicy=77 cacao=61          → 木质玫瑰
   *   完美先生香精 almond=100 leather=74                   → 苦杏仁 + 皮革
   *   万圣节男士X warm spicy=100 coffee=59                 → 焙烤咖啡
   * 这四款核心甜调（sweet/vanilla/caramel/honey）全部 <30，却会被判「甜感偏重、容易发腻」。
   *
   * 保留 chocolate 而排除 cacao 是有意的：调香词汇里 chocolate 指向甜制品，cacao 指向生豆的苦。
   * 真正甜的那些香，本来就会由 sweet / vanilla 命中，不需要靠这些邻居兜底。
   */
  sweet: ["sweet", "vanilla", "caramel", "honey", "chocolate", "gourmand"],
  /** 树脂香膏 + 琥珀：厚、闷、不透气，但**不甜** */
  balsamic: ["amber", "balsamic", "oud", "beeswax"],
  /** 清冽 */
  fresh: ["citrus", "aquatic", "marine", "green", "aromatic", "fresh", "ozonic", "herbal", "mineral"],
  /** 暖：冷天占便宜的那一类 */
  warm: ["amber", "balsamic", "warm spicy", "vanilla", "leather", "tobacco"],
  floral: ["floral", "white floral", "yellow floral", "rose", "tuberose", "violet", "iris", "lactonic"],
  earthyDark: ["earthy", "leather", "tobacco", "smoky", "animalic", "patchouli", "mossy"],
  spicy: ["warm spicy", "fresh spicy", "soft spicy", "cinnamon", "anis"],
  woodyAmber: ["amber", "woody", "oud", "balsamic", "patchouli"],
} as const;

/** 引擎依赖的全部香调键——供单测对真实数据集做"无幽灵键"校验 */
export const ENGINE_ACCORD_KEYS: string[] = [
  ...new Set([...Object.values(F).flat(), "woody", "white floral", "animalic", "tobacco", "citrus", "aromatic"]),
];

/** 甜度（美食调）——"发腻"风险的唯一依据 */
export function sweetness(p: Perfume): number {
  return maxStrength(p, F.sweet);
}
/** 树脂/香膏厚度——"闷、不透气"风险的依据，与甜无关 */
export function balsamicWeight(p: Perfume): number {
  return maxStrength(p, F.balsamic);
}
function anyStrength(p: Perfume, names: readonly string[], min: number): boolean {
  return names.some((n) => accStrength(p, n) >= min);
}
function maxStrength(p: Perfume, names: readonly string[]): number {
  return Math.max(0, ...names.map((n) => accStrength(p, n)));
}

/**
 * 家族**主导度** = 该族最强项 ÷ 这瓶最强的 accord（0..1）。
 *
 * accord 的 strength 是相对**这一瓶自身轮廓**的排位强度，首位几乎总是 100，不是绝对浓度。
 * 于是同一个「sweet=54」，在蓝风铃里只是第五位的一点甜尾（powdery 100 / musky 98 / green 95），
 * 在烟草香草里却是 vanilla=100 的主体。拿绝对阈值判"这瓶厚不厚重"，必然把前者也判进去：
 * 实测主目录 1500 款里有 855 款过了 ≥50 的绝对线，其中包括蓝风铃、信仰之水、旷野、
 * 蔚蓝、绿爱尔兰花呢这些公认的清爽香。
 *
 * 这是 amber 混进甜桶那个归类错误的**下一层**：上次修的是「哪些键属于哪一族」，
 * 这次修的是「某一族要占到多重，才配代表这瓶的气质」。同一族里换键还会再犯，
 * 换成比例判据才是把这一类堵死。
 *
 * 0.75 不是拍的。对主目录全量实测，两簇之间有 0.29 的空档：
 *   公认厚重  烟草香草 1.00 · 黑鸦片 1.00 · 天使 1.00 · 香水炸弹极致 1.00 · 红 540 0.97
 *   公认清爽  绿爱尔兰花呢 0.68 · 旷野 0.59 · 信仰之水 0.55 · 蓝风铃 0.54 · 蔚蓝 0.53
 * 门槛落在空档中央，±0.05 结论不变。
 */
export function familyDominance(p: Perfume, names: readonly string[]): number {
  const top = Math.max(1, ...p.accords.map((a) => a.strength));
  return maxStrength(p, names) / top;
}

/** 「这一族代表了这瓶的气质」的统一门槛 */
export const DOMINANT = 0.75;

/** 甜/树脂香膏是否主导这瓶——高温闷重判定与衣物留印提示共用同一条口径 */
export function richDominates(p: Perfume, absMin: number): boolean {
  const keys = [...F.sweet, ...F.balsamic];
  return maxStrength(p, keys) >= absMin && familyDominance(p, keys) >= DOMINANT;
}

// 「不知道」不等于「满分」。
// 原公式 当前季占比 ÷ 最高季占比 有一个致命性质：**分布越平坦，得分越高**。
// 手动记录的香 seasonPct 是 0.25×4（我们诚实地不假装知道），代入后四季恒得 1.0——
// 于是一瓶我们一无所知的香，在季节项上打平一瓶社区一万票认证的完美对季香。
// 低票扩展集同理：三五票的噪声分布会偶然出现尖峰，同样被当成强信号。
//
// 修法：按票数把原始适配度向**全库经验均值**收缩。没有数据 → 落在平均水平，
// 而不是落在满分。锚点不是拍的，是在 1500 款主目录 × 四季共 6000 个样本上实测出来的。
const SEASON_ANCHOR = 0.671; // 全库 seasonFit 均值（实测，见 docs/领域规则手册.md）
const DAYPART_ANCHOR = 0.771; // 全库 daypartFit 均值（实测）
const CONF_K = 60; // 票数半衰点：60 票时置信度 0.5；主目录最低 1131 票 → 置信度 ≥0.95，几乎不受影响

/** 社区数据置信度 0..1：手动记录恒为 0（它本来就没有社区数据） */
export function dataConfidence(p: Perfume): number {
  if (p.custom) return 0;
  const n = Math.max(0, p.people ?? 0);
  return n / (n + CONF_K);
}

function shrink(raw: number, anchor: number, conf: number): number {
  return anchor + (raw - anchor) * conf;
}

// 季节适配：当前季占比 ÷ 该香最高季占比 → 0..1（在主场得 1），再按票数收缩
export function seasonFit(p: Perfume, season: Season): number {
  const vals = Object.values(p.seasonPct);
  const max = Math.max(...vals);
  if (max <= 0) return SEASON_ANCHOR;
  return shrink(p.seasonPct[season] / max, SEASON_ANCHOR, dataConfidence(p));
}

// 时段适配：相对该香自身主场归一（与 seasonFit 同构，避免原始占比中心≈0.58、std 偏小
// 导致 0.19 名义权重被稀释成实际约 0.035 的影响力——偏夜香在夜里得 1），同样按票数收缩
export function daypartFit(p: Perfume, ctx: Context): number {
  const cur = ctx.daypart === "day" ? p.daypartPct.day : p.daypartPct.night;
  const max = Math.max(p.daypartPct.day, p.daypartPct.night);
  if (max <= 0) return DAYPART_ANCHOR;
  return shrink(cur / max, DAYPART_ANCHOR, dataConfidence(p));
}

/**
 * 天气修正的**归因**。
 * 此前 weatherMultiplier 只返回一个标量，加成"因为什么"在那一步就丢了；
 * 下游 buildReasons 只能靠 `W >= 1.08` 反推，于是把所有加成一律解释成"清爽通透"——
 * 冷天给暖调的 ×1.15 加成也落进这个分支，2℃ 推烟草香草时会写出
 * 「香草·甜调·烟草的调性清爽通透，正合今天的天气」。
 * 更糟的是这句是 reasons[0]，会作为"事实"送进 /api/explain，
 * 而那边的铁律第一条是"只能使用我给你的事实"——规则引擎把错话标成事实，再要求 LLM 忠实复述。
 * 数字白名单拦得住编造的数字，拦不住上游喂进去的错误语义。所以归因必须在算的那一刻就带出来。
 */
export type WeatherTone =
  | "fresh_in_heat" // 清冽调在暖/热天占便宜
  | "warm_in_cold" // 暖调在冷天占便宜
  | "heavy_in_heat" // 厚重调在热天吃亏
  | "thin_in_cold" // 清冽调在冷天吃亏（薄、飘、留不住）
  | "neutral";

export interface WeatherResult {
  w: number;
  tone: WeatherTone;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * 体感档反推的代表性温湿度。
 * 只服务于**没有提供实测温湿度**的调用方（单测、以及只拿到 Feel 的旧路径）。
 * 真实推荐路径永远从 `Context` 传实测值进来，不走这里。
 */
function fallbackClimate(feel: Feel): { t: number; h: number } {
  switch (feel) {
    case "hot_humid":
      return { t: 31, h: 78 };
    case "hot_dry":
      return { t: 31, h: 40 };
    case "cold":
      return { t: 5, h: 55 };
    default:
      return { t: 20, h: 55 };
  }
}

export function weatherFit(p: Perfume, feel: Feel, tempC?: number, humidity?: number): WeatherResult {
  // 厚重 = 甜(美食) ∪ 树脂香膏 ∪ 动物性/烟草：高温下最容易变闷的几族
  const heavy = [...F.sweet, ...F.balsamic, "animalic", "tobacco"];
  const fresh = [...F.fresh];
  // 暖木子集：不含裸 woody——「木质」是最宽家族，干冷的岩兰草/雪松并非取暖型香，
  // 用组合判定（下方 warmish）而非把整个 woody 当暖调。
  const warmish =
    anyStrength(p, [...F.warm], 45) ||
    (accStrength(p, "woody") >= 45 && maxStrength(p, ["amber", "balsamic", "warm spicy"]) >= 40);

  // 每条生效的修正都连同它的归因一起记下来
  const effects: { tone: WeatherTone; f: number }[] = [];
  const hit = (tone: WeatherTone, f: number) => effects.push({ tone, f });

  // ── 连续体感量：打分路径不再吃离散的 Feel ────────────────────────────────
  //
  // 离散分档在这里制造了三处真实可感的断崖，而且方向恰好是错的：
  //   · 27.9℃ 走 mild（厚重 ×0.96），28.0℃ 走 hot_dry（×0.88）—— 0.1℃ 换 8 个百分点；
  //   · 28℃/64% 与 28℃/66% 差 4 个点，而湿度在这一带**根本没有被验证过的效应量**；
  //   · 最没道理的一处：34℃ 与 28℃ 拿到完全相同的乘子。温度是本轮循证里唯一方向可靠的变量，
  //     却恰恰在最需要区分的高温段被离散化抹平了。
  //
  // 这也与本文件自己的既定原则冲突——occasionFit 的注释写着「连续函数，不设悬崖，
  // 60/61 之间不许出现 0.03 级的总分跳变」。同一份代码不该两套标准。
  //
  // 【断点全部是启发式】22/35/15/2℃、60/90% 没有任何实证依据。选取原则不是"更准"，
  // 而是让新曲线在原有阈值附近平滑穿过、并在高温段继续加强。Feel 枚举保留，
  // 但只用于文案（FEEL_ZH、风险话术的"又热又潮"、WearEntry.feel），不再进打分。
  const fb = fallbackClimate(feel);
  const t = tempC ?? fb.t;
  const rh = humidity ?? fb.h;
  const H = clamp01((t - 22) / 13); // 热负荷：22℃ 起算、35℃ 饱和
  const C = clamp01((15 - t) / 13); // 冷负荷：15℃ 起算、2℃ 饱和
  const M = H > 0 ? clamp01((rh - 60) / 30) : 0; // 闷指数：仅在有热负荷时生效

  // 高温惩罚由**温度**主导，湿度只做小幅加成——这正是本轮最重要的方向性修正：
  // 原实现把防护只挂在 hot_humid 上，等于把"湿"当成了主变量。
  // 保留一点湿度项的理由也换了：不是"湿空气锁住香气"（已推翻），而是**热舒适度**——
  // 高湿下汗液蒸发散热受阻，佩戴者与周围人本身处在更高的不适阈值，同样浓度更容易越过"过头"线。
  // 反过来，干热下蒸发散热有效，皮温往往还低于同气温的湿热。
  //
  // ⚠️ 不要拿 Clausius–Clapeyron 给这些系数背书。皮温是被体温调节的（环境升 9℃、皮温只升约 3.5℃），
  // 再经嗅觉的 Stevens 幂律（n≈0.2–0.3）传到主观强度只剩个位数百分比，就在最小可辨差附近。
  // 方向站得住，量级站不住。要标定只能靠用户反馈做 A/B，不能靠再拍一次脑袋。
  if (H > 0) {
    // 厚重要求这一族**主导**这瓶，而不只是越过绝对线（见 familyDominance）：
    // 没有这道比例判据，蓝风铃（sweet 是它第五位的 54）会和烟草香草（vanilla=100）
    // 拿到同一句「它偏厚重，今天的体感里要留意会不会闷」。
    if (anyStrength(p, heavy, 50) && familyDominance(p, heavy) >= DOMINANT)
      hit("heavy_in_heat", 1 - 0.13 * H - 0.06 * M);
    if (anyStrength(p, fresh, 45)) hit("fresh_in_heat", 1 + 0.12 * H);
  }
  // 冷侧两条**都没有物理支持**——按被引物理算，低温下低挥发材料被压制得更狠，方向甚至相反。
  // 保留它们的唯一正当理由是用户偏好与文化预期【文化惯例】，不是挥发学。
  if (C > 0) {
    if (warmish) hit("warm_in_cold", 1 + 0.12 * C);
    // 清冽家族含 citrus：纯柑橘/古龙在严寒里最薄、飘、留不住（暖调守卫防止误伤东方柑橘）
    else if (anyStrength(p, ["aquatic", "marine", "ozonic", "citrus"], 50)) hit("thin_in_cold", 1 - 0.08 * C);
  }

  // clamp 维持 [0.7, 1.3] 不变。合成阶段曾建议收紧到 [0.85, 1.15]，此处不采纳，两个理由：
  //   ① 对抗性复核明确反对收紧——"皮温随气温变化幅度小"只对躯干颈部成立，
  //      手腕是肢端部位、受血管舒缩强烈调制，气温 20→30℃ 可能带来 5–8℃ 的皮温差；
  //   ② 按新曲线算，35℃/90% 得 0.81，若截断到 0.85 就会与 32℃ 的 0.85 重合，
  //      在顶端**重新制造塌缩**——正是这次要修的那个毛病。
  // 实际取值范围约 [0.81, 1.12]，这个 clamp 从不触发，是纯安全网。
  const w = Math.max(0.7, Math.min(1.3, effects.reduce((acc, e) => acc * e.f, 1)));
  // 一瓶香可能同时吃到加成和惩罚（如清新柑橘里带香草）——由影响最大的那条决定怎么措辞
  const dominant = effects.length
    ? effects.reduce((a, b) => (Math.abs(Math.log(b.f)) > Math.abs(Math.log(a.f)) ? b : a))
    : null;
  return { w, tone: dominant?.tone ?? "neutral" };
}

// 天气乘性修正系数 W ∈ [0.7, 1.3]（只要数值时的薄封装）
export function weatherMultiplier(p: Perfume, feel: Feel, tempC?: number, humidity?: number): number {
  return weatherFit(p, feel, tempC, humidity).w;
}

/**
 * 场景适配 0..1（按真实香调家族判定，让不同气质的香在不同场合明显拉开）。
 *
 * ⚠️ 这个函数里混着两类**证据强度完全不同**的规则，后来者改动前必须先分清：
 *
 * 【A 类 · 安全与礼仪】有扎实的公共卫生依据。约三分之一人群报告对香味制品有不良反应，
 * CDC、加州公共卫生部、CCOHS 等机构都有正式的无香政策，医院与部分办公场所强制执行。
 * 「密闭/共享空间应当减量」「强扩散香在会议室里是问题」属于这一类，可以理直气壮。
 * 对应：各分支里的 `tier >= 4 → 扣分`，以及 usage.ts 里按空间密度减喷量。
 *
 * 【B 类 · 风格与文化惯例】**没有任何可引用的消费者研究**。
 * 「职场偏清爽木质」「约会偏甜花」「运动要清新」——循证复核的结论是：这些是文化建构与社交惯例，
 * 不是科学。下面每一个加减分系数（0.4 / 0.3 / 0.2 …）都是编者先验，没有实证标定。
 * 对应：各分支里所有按香调家族的加减分。
 *
 * 保留 B 类是正确的——它就是这个产品要提供的判断，用户要的正是"一个懂行的人会怎么选"。
 * 但有两条纪律：
 *   ① 不许对用户宣称它有科学依据。文案只说"这类场合一般更稳妥"，绝不说"研究表明"。
 *   ② 不要为了"更精确"去微调这些系数——把一个没依据的数换成另一个没依据的数是退步不是进步。
 *      要改，正确路径是收集真实用户反馈做 A/B，而不是再拍一次脑袋。
 * 这也是为什么个人反馈（biasMul / sceneMismatch）必须能压过它们：
 * 证据里最硬的一条恰恰是"合不合适高度个体化"——同一款香与不同人体味混合后愉悦度差异显著。
 * 通用规则只是先验，你的反馈才是证据。
 */
export function occasionFit(p: Perfume, ctx: Context): number {
  const fresh = maxStrength(p, [...F.fresh]);
  const sweet = sweetness(p);
  const amberWoody = maxStrength(p, [...F.woodyAmber]);
  const floral = maxStrength(p, [...F.floral]);
  const earthyDark = maxStrength(p, [...F.earthyDark]);
  const spicy = maxStrength(p, [...F.spicy]);
  const tier = p.sillageTier;
  const n = (v: number) => v / 100;
  // 所有风格权重来自 occasion-priors.ts —— 那个文件里没有一个数字有科学依据，
  // 单独放是为了让这件事在结构上就看得见，而不是靠一段注释提醒。
  const { romantic, proper, sport, relaxed } = OCCASION_WEIGHTS;
  const D = FAMILY_DISCOUNT;
  let s = 0.5;
  switch (ctx.occasion) {
    case "date":
    case "social":
      // 浪漫/social：甜、花最讨喜；泥土/木质/辛辣不浪漫；纯清冽也不够暧昧
      s += romantic.favorSweetFloral * n(Math.max(sweet, floral));
      // 温和木质加暖意，过 60 后斜坡淡出（连续函数，不设悬崖——60/61 之间不许出现 0.03 级的总分跳变）
      s += romantic.favorWarmWood * n(amberWoody <= 60 ? amberWoody : Math.max(0, 60 - (amberWoody - 60) * 1.5));
      s -= romantic.againstEarthyDark * n(Math.max(earthyDark, spicy * D.dateSpicy));
      if (fresh > 70 && sweet < 30 && floral < 30) s -= romantic.penaltyTooFresh;
      if (ctx.occasion === "date" && tier >= 4) s -= LOUD_PENALTY.date;
      break;
    case "formal":
    case "work":
    case "commute":
      // 得体：干净木质/柑橘/草本；反甜、反花、反脏气、反爆炸
      s += proper.favorCleanWoodFresh * n(Math.max(amberWoody * D.formalAmberWoody, fresh, spicy * D.formalSpicy));
      s -= proper.againstSweet * n(sweet);
      s -= proper.againstFloral * n(floral);
      s -= proper.againstEarthyDark * n(earthyDark);
      if (tier >= 4) s -= LOUD_PENALTY.formal;
      break;
    case "sport":
      // 清爽：清新/柑橘/水生；强烈反甜、反重、反木
      s += sport.favorFresh * n(fresh);
      s -= sport.againstHeavy * n(Math.max(sweet, amberWoody, earthyDark));
      if (tier >= 3) s -= LOUD_PENALTY.sport;
      break;
    case "home":
    case "casual":
      // 放松：柔和舒适皆可，反强扩散
      s += relaxed.favorAny * n(Math.max(sweet, amberWoody, fresh, floral) * D.relaxed);
      if (tier >= 4) s -= LOUD_PENALTY.relaxed;
      break;
  }
  // 软下限（保序）：低分区不再硬夹到 0.05 常数，避免同质库多瓶一起撞底板→场合项(0.43 最高权重)
  // 在该场景退化为同分、区分力≈0。低于 0.05 时单调压缩进 (0, 0.05]，仍保留候选间的相对次序。
  if (s >= 0.05) return Math.min(1, s);
  return 0.05 / (1 + (0.05 - s) * 6);
}

// 质量先验：贝叶斯收缩后压成 ±4% 的温和微调（0.96~1.04，中心 1.0）。
// 关键：同一用户库内，"今天喷哪瓶"该由场景/季节/天气决定，社区评分只作轻微 tiebreak，
// 不能让某瓶高分香跨场景通吃（否则又回到"永远推荐大地"）。未评分记 1.0，不惩罚。
// 收缩靶心 M 与中性锚点必须是同一个值——否则"中评+少票"会比"没评分"更差，"不惩罚"名不符实。
export function qualityPrior(p: Perfume): number {
  if (p.rating == null) return 1;
  const C = 30, M = 4.0;
  const shrunk = (p.rating * p.people + M * C) / (p.people + C);
  return Math.max(0.96, Math.min(1.04, 1 + (shrunk - M) * 0.08));
}

export interface ScoreParts {
  total: number;
  season: number;
  daypart: number;
  occasion: number;
  weather: number;
  weatherTone: WeatherTone; // 天气加/扣分的归因——措辞必须由它决定，不许由 weather 数值反推
  quality: number;
  confidence: number; // 社区数据置信度：决定我们有没有资格说"社区投票里…"
}

// 场景规避惩罚：自然语言解析出的 avoid（别太甜/太冲/太正式…）→ 乘性降权
export function avoidPenalty(p: Perfume, avoid?: string[]): number {
  if (!avoid || avoid.length === 0) return 1;
  let m = 1;
  const has = (t: string) => avoid.includes(t);
  // 「别太甜」只该罚真正的甜——琥珀不在其列。混进 amber 会让用户说一句"别太甜"，
  // 就把蔚蓝浓香精(sweet=0)、旷野这些一点也不甜的香罚掉 32%。
  if (has("too_sweet") || has("cloying")) {
    if (sweetness(p) >= 50) m *= 0.68;
  }
  if (has("too_strong")) {
    if (p.sillageTier >= 4) m *= 0.6;
    else if (p.sillageTier === 3) m *= 0.8;
  }
  if (has("too_formal") && p.styleTags.includes("正式商务")) m *= 0.8;
  if (has("too_casual") && (p.styleTags.includes("日常百搭") || p.styleTags.includes("清新通勤"))) m *= 0.85;
  return m;
}

// 场景张力与正式度：由自然语言解析产出，此前只存不用——"氛寸读到「第一次见投资人」"
// 若不影响任何一个数字，那句回显就是纯表演。这里让它真的进打分。
// · tension=high（前任婚礼 / 谈判 / 见家长）：香水不该成为这场合的话题，
//   压强扩散、压高辨识度的甜美食调——存在感本身就是风险。
// · formality ∈ [0,1]：连续的正式程度，比 occasion 八个枚举细。用户说"很正式的场合"时，
//   哪怕 occasion 落在 social，也要能收得住。
export function socialToneMultiplier(p: Perfume, ctx: Context): number {
  let m = 1;
  const gourmand = maxStrength(p, ["sweet", "vanilla", "caramel", "honey", "chocolate", "gourmand"]);
  if (ctx.tension === "high") {
    if (p.sillageTier >= 4) m *= 0.7;
    else if (p.sillageTier === 3) m *= 0.85;
    if (gourmand >= 55) m *= 0.85;
  }
  if ((ctx.formality ?? 0) >= 0.7) {
    if (p.sillageTier >= 4) m *= 0.8;
    if (gourmand >= 55) m *= 0.85;
  }
  return m;
}

// 个人偏置：likeScore ∈ [-1,1] → 乘子 0.75..1.25；perceivedStrength 影响后续用法（此处不用）
export function score(p: Perfume, ctx: Context, bias?: Bias): ScoreParts {
  const sSeason = seasonFit(p, ctx.season);
  const sDay = daypartFit(p, ctx);
  const sOcc = occasionFit(p, ctx);
  const wf = weatherFit(p, ctx.feel, ctx.tempC, ctx.humidity);
  const W = wf.w;
  const Q = qualityPrior(p);

  // 线性组合（权重显式、归一到 1、可单测、可向用户解释）；occasion 略高于 season——
  // "今天去哪儿"比"现在什么季"更该决定喷哪瓶（急性温度已由乘性 W 兜底），让场景赢下真正的平局。
  // 个人偏好不占加性权重，改由下方 biasMul 乘性承担。
  const linear = 0.38 * sSeason + 0.19 * sDay + 0.43 * sOcc;
  const biasMul = 1 + (bias?.likeScore ?? 0) * 0.25;
  // 「不合场合」反馈：该瓶在该场合被点名不搭 → 按次数降权（每次 -10%，封顶 -30%，反向反馈可抵消）
  const mismatch = Math.min(3, bias?.sceneMismatch?.[ctx.occasion] ?? 0);
  const mismatchMul = 1 - 0.1 * mismatch;
  const total =
    linear * W * Q * biasMul * mismatchMul * avoidPenalty(p, ctx.avoid) * socialToneMultiplier(p, ctx);
  return {
    total,
    season: sSeason,
    daypart: sDay,
    occasion: sOcc,
    weather: W,
    weatherTone: wf.tone,
    quality: Q,
    confidence: dataConfidence(p),
  };
}
