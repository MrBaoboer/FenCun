// 推荐编排：打分 → 轮换加权 → 排序 → 主推 + 备选，并为每个候选附上用法/风险/理由/裁决
import type { Perfume, Context, ScoredPick, Verdict, AvoidCause, Bias, Feedback, Occasion, SuccessConfig } from "./types";
import { score, sweetDominates, stainProneDominates, dataConfidence, WEATHER_CAUTION, type ScoreParts } from "./scoring";

/** 单个 accord 强度（留印风险判定用） */
const accordAt = (p: Perfume, en: string) => p.accords.find((a) => a.en === en)?.strength ?? 0;
import { computeUsage, computeRiskNotes, buildReasons, isBottleRisk } from "./usage";
import { tempBand } from "./season";
import { isClosedOccasion } from "./occasion-priors";

export type { Bias } from "./types";

const DAY_MS = 24 * 3600 * 1000;

// 本地日历日零点（毫秒）——daySeed 与"隔了几天"都以本地日为准。
// 之前用 UTC 日切换，中国用户的"今日推荐"会在早上 8 点整突变，正踩在出门决策窗口上。
export function dayFloor(ts: number): number {
  return new Date(ts).setHours(0, 0, 0, 0);
}

// 轮换新鲜度：昨天刚喷的今天自然让位，久置的自然浮起。
// d=同一天 → 1（今天已经选了它，答案不在一天内摇摆）；d=1 → ≈0.58；d=2 → 0.70；d=4 → 0.85；d≥7 → ≈1。
// 只影响排序，不改内容分与裁决——"这瓶适不适合今天"和"要不要连着喷它"是两个问题。
export function freshness(lastWornAt: number | undefined, now: number): number {
  if (!lastWornAt) return 1;
  const d = Math.round((dayFloor(now) - dayFloor(lastWornAt)) / DAY_MS);
  if (d <= 0) return 1;
  return 1 - 0.6 * Math.pow(0.5, d / 2);
}

// 换瓶是隐式差评：主推被手动换掉，说明"分数说它行，你说它不行"。
// 7 天内在 ≥2 个不同天被换掉 → ×0.8；随时间自动失效，不永久拉黑。
export function swapPenalty(swapAwayTs: number[] | undefined, now: number): number {
  if (!swapAwayTs?.length) return 1;
  const days = new Set(
    swapAwayTs.filter((t) => now - t < 7 * DAY_MS).map((t) => dayFloor(t))
  );
  return days.size >= 2 ? 0.8 : 1;
}

// 用香裁决 —— 不迁就用户：确实不合的场景明确判 avoid
function computeVerdict(
  p: Perfume,
  ctx: Context,
  parts: ScoreParts,
  risks: string[]
): { verdict: Verdict; avoidCause: AvoidCause | null } {
  // 无香场合：无论哪一瓶都判 avoid。这不是"这瓶不合适"，是"今天哪瓶都不合适"
  if (ctx.fragranceFree) return { verdict: "avoid", avoidCause: "fragrance_free" };
  const entries = Object.entries(p.seasonPct) as [keyof typeof p.seasonPct, number][];
  const best = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  // 反季判定必须过票数门槛，和它对应的那句风险文案用**同一道**闸（usage.ts:computeRisks）。
  // 原来只有文案有门槛、裁决没有，于是低票记录会走到一个荒唐的位置上：
  // 判了「今天不建议」，却一条风险都说不出来——实测扩展集 35990 条里有 3874 条正处在这个状态，
  // 而解释位还挂着「和今天比较合拍」。主目录一条都没有（票数高，恒过门槛），
  // 所以这个洞只在"搜冷门香入柜"这条最常见的路径上暴露。
  // 更根本的问题是：avoid 是输出最强、最不可逆的一档，却由三五十票的噪声分布驱动。
  const seasonKnown = !p.custom && !p.lowVotes && dataConfidence(p) >= 0.75;
  const seasonMiss = seasonKnown && best[0] !== ctx.season && best[1] - p.seasonPct[ctx.season] >= 0.22;
  const tooLoudClosed = p.sillageTier === 4 && isClosedOccasion(ctx.occasion);
  // 成因随裁决一起带出来，顺序即优先级：天气最强、其次反季、最后场地。
  // 下游只认这个字段，不许再从 parts 的数值反推——数值说得出"扣了分"，说不出"因为什么"。
  // 「今天太热，这瓶今天别用」由**温度与归因**说了算，不由乘子数值反推。
  // 旧写法是 `parts.weather <= 0.82`，而 weatherFit 的下界就是 0.81——阈值落在曲线
  // 最后一个百分点里，实测要求露点 ≥32℃（中国最高露点纪录 29℃ 上下），
  // 也就是说 avoidCause="weather" 在真实气象下基本不可达：为它专门写的眉标
  //「今天的体感」与那句兜底几乎永不渲染，「天气突变预警」这个名字底下
  // 用户能看到的只有 season 与 venue 两种成因。而 34.0℃ 那一点的结论还由浮点尾数决定。
  // 换成落在有语义的量上：这瓶由厚重族主导（tone 已经这么判了），且热负荷接近饱和
  //（H≥0.9 ⇔ 约 33.7℃ 以上）。成因与 tone 天然同源，也不再有浮点边界。
  // ⚠️ 已知未修：这条固定线是一处**断崖**。实测 33℃ 时天气成因 0 款、34℃ 时 577 款
  // （主目录 38%）同时翻，34→38℃ 再无变化；同一瓶香在 33.9℃ 与 34.0℃ 两次刷新之间
  // 会从「今天还行」跳到「今天不建议」。
  //
  // 试过让门槛随厚重主导度滑动来摊开这一刀，实测**不成立**：主导度在真实数据里聚在 1.0
  // （厚重族本来就常是这瓶的首位 accord），断崖只是从 33.7℃ 挪到 31.75℃（0 → 398 款），
  // 同时把 32–33.7℃ 这一段的触发面从 0 扩到 398–545——那是"让它更早生效"，
  // 是另一个产品决定，不是"只去断崖"。
  //
  // 二元裁决对连续输入必然有台阶，真正要选的是：保持严格（接受台阶）还是降低阈值
  // （扩大劝退面）。这属于产品取舍，留给下一轮显式决定，不在这里悄悄改掉——
  // avoid 是输出最强、最不可逆的一档。
  //
  // 降级情境（拿不到天气）下，天气一律不参与裁决：那时 ctx.tempC 是 hooks.ts 按季节
  // 填的代表温度（夏 27 / 冬 6 / 春 18 / 秋 16），不是读数。文案层已经因此闭嘴
  //（usage.ts 里的 !ctx.approximate），裁决层不跟着停手就又成了「判了说不出为什么」
  // ——实测降级冬季 40 款正落在这里：判了 caution，风险清单是空的。
  const weatherKnown = !ctx.approximate;
  if (weatherKnown && parts.weatherTone === "heavy_in_heat" && parts.heatLoad >= 0.9)
    return { verdict: "avoid", avoidCause: "weather" };
  if (seasonMiss) return { verdict: "avoid", avoidCause: "season" };
  if (tooLoudClosed) return { verdict: "avoid", avoidCause: "venue" };
  // 第二个触发源与 computeRiskNotes 共用同一个常量：天气压到这条线以下就判 caution，
  // 而同一条线也是那边"必须说得出一句话"的门槛。两边各写一个 0.95，就会重演
  // 「数字收了、话没说」——这次是反过来的形态：「判了、说不出为什么」。
  if (risks.length > 0 || (weatherKnown && parts.weather < WEATHER_CAUTION))
    return { verdict: "caution", avoidCause: null };
  return { verdict: "good", avoidCause: null };
}

export function buildPick(p: Perfume, ctx: Context, bias?: Bias): ScoredPick {
  const parts = score(p, ctx, bias);
  const notes = computeRiskNotes(p, ctx);
  const risks = notes.map((n) => n.text);
  const usage = computeUsage(p, ctx, bias);
  // ⚠️ 裁决只吃**本瓶风险**，且必须在追加织物提示**之前**算完。
  //
  // 两件事同一个道理：computeVerdict 的规则是 risks.length > 0 → caution，而它要回答的是
  //「这一瓶今天要不要留意」。凡是对柜里每一瓶都成立的句子，都没有资格进这个入口——
  //   · 织物留印是**提示**：先追加再判，所有封闭场合（通勤/上班/正式，最常见的那几个）会被无端降级；
  //   · 场景提示是**场合级**：一旦进来，全柜同时 caution，good 归零（见 usage.ts:isBottleRisk）。
  // 上一次靠调用顺序绕开了第一件，这一次把第二件变成带类型的判据，两条都不再依赖"记得别写错"。
  const { verdict, avoidCause } = computeVerdict(p, ctx, parts, notes.filter(isBottleRisk).map((n) => n.text));
  // 触发这次 avoid 的**那一条**风险，与成因同源取出（见 usage.ts:computeRiskNotes）。
  // 预警卡的正文要它：眉标按成因分岔，正文就不能再猜 risks[0]。
  // 取不到时下游退到按成因写死的兜底句，仍然对得上眉标。
  const avoidRisk =
    avoidCause && avoidCause !== "fragrance_free"
      ? notes.find((n) => n.kind === avoidCause)?.text ?? null
      : null;
  // 建议喷衣物时，把真实存在的那个代价一并说了：高浓度乙醇 + 香精油脂 + 有色浸膏的光氧化黄变，
  // 对真丝、醋酸纤维和浅色外层是实打实的留印风险【行业惯例】。
  // 放在这里而不是 computeRisks 里，是为了避免把 placement 的判定逻辑抄第二份——
  // 条件就是"最终真的建议了衣物"，不需要再推导一遍。
  // 只对**真的会留印**的组分提示。机制是有色浸膏、树脂与香草醛的油渍及光氧化黄变，
  // 清爽柑橘/水生本来就不在其列。不收窄的话，夏天几乎每张卡都建议喷衣物，
  // 这句就会变成每次都出现的噪音——一条永远出现的提示等于没有提示。
  //
  // 只用绝对阈值收得**不够**：实测主目录 1500 款里 967 款（64.5%）过线，
  // 连蓝风铃（sweet 是第五位的 54）和旷野（Ambroxan 干琥珀 59）都在内——
  // 那句"永远出现的提示"其实一直在出现。所以判据换成主导度。
  //
  // 但留印这条不能直接复用 richDominates：它的机制是**有色浸膏与香精油脂的油渍
  // 及光氧化黄变**，而 familyDominance 的分母是"这瓶最强的 accord"，于是 amber
  // 只要与首位同量级就算主导——蔚蓝浓香精（首位 citrus=100、amber=86、sweet=0）
  // 这类以 Ambroxan 干琥珀当骨架的清冽香照样中招，实测 26 款。Ambroxan 是无色合成体，
  // 恰在上面那段自陈的机制之外。数据层区分不了干琥珀与甜东方琥珀（见 scoring.ts 的
  // 同一处代价），所以留印这条按机制**宁可漏报**：把 amber 排除在留印族之外，
  // 只认真正有色的树脂/香膏/沉香/蜂蜡，甜那一族照旧（香草醛与焦糖是实打实的油渍源）。
  // tobacco 单列且仍用绝对阈值：烟草的焦油质地本身就会在织物上留色，不问它占多重。
  //
  // 成因不同，话就得分开说。此前三条判据共用一句「它的树脂与浸膏可能留印子」，
  // 于是 26 款靠 tobacco 触发、而柑橘/辛香当家的香被扣上一个它自己不成立的机制——
  // 与本文件反复在修的「归因必须与结论同源」是同一件事，只是藏在一句文案里。
  const stainByResin = sweetDominates(p, 40) || stainProneDominates(p, 40);
  const stainByTobacco = accordAt(p, "tobacco") >= 40;
  if ((stainByResin || stainByTobacco) && usage.placement.some((x) => x.includes("衣物"))) {
    risks.push(
      stainByResin
        ? "喷衣物请选内衬，避开真丝、醋酸和浅色外层——它的树脂与浸膏可能留印子。"
        : "喷衣物请选内衬，避开真丝、醋酸和浅色外层——烟草这类原料的质地容易在织物上留色。"
    );
  }
  const reasons = buildReasons(p, ctx, {
    season: parts.season,
    weather: parts.weather,
    weatherTone: parts.weatherTone,
    occasion: parts.occasion,
    confidence: parts.confidence,
  });
  // 个人化校准说明放进"为什么"要点：被感知的校准才是留存钩子
  if (usage.note) reasons.unshift(usage.note);
  return {
    perfume: p,
    score: parts.total,
    breakdown: {
      season: parts.season,
      daypart: parts.daypart,
      occasion: parts.occasion,
      weather: parts.weather,
      quality: parts.quality,
    },
    usage,
    risks,
    reasons,
    verdict,
    avoidCause,
    avoidRisk,
  };
}

export interface RecommendExtras {
  daySeed?: number;
  lastWornAt?: Map<number, number>; // perfumeId → 上次采纳时间戳
  swapAways?: Map<number, number[]>; // perfumeId → 近期被从主推位换掉的时间戳
  now?: number; // 供测试注入
}

export function recommend(
  perfumes: Perfume[],
  ctx: Context,
  biasMap?: Map<number, Bias>,
  extras: RecommendExtras = {}
): {
  primary: ScoredPick | null;
  alternatives: ScoredPick[];
  ranked: ScoredPick[];
  /** 柜里今天没有一瓶判 good/caution——UI 必须换一套说法，不能继续叫「今日之选」 */
  allAvoid: boolean;
} {
  const now = extras.now ?? Date.now();
  const daySeed = extras.daySeed ?? 0;

  // 排名分 = 内容分 × 轮换新鲜度 × 换瓶隐式差评。内容分保留在 pick.score（裁决与展示不受轮换影响）。
  const scored = perfumes.map((p) => {
    const pick = buildPick(p, ctx, biasMap?.get(p.id));
    const rank =
      pick.score *
      freshness(extras.lastWornAt?.get(p.id), now) *
      swapPenalty(extras.swapAways?.get(p.id), now);
    return { pick, rank };
  });

  // 两段式排序：先严格按排名分降序（合法全序，分高者必在前）——
  // 再对相邻近似同分做单调聚簇、仅簇内按 hash(id, 本地日) 稳定轮换。
  // 不把 epsilon 写进 sort 比较器：epsilon 比较器不满足严格弱序，同质香柜下会出现分高者排后。
  scored.sort((a, b) => b.rank - a.rank);
  const EPS = 0.012;
  const rot = (id: number) => (((id * 2654435761 + daySeed * 40503) >>> 0) % 1000) / 1000;
  const ranked: ScoredPick[] = [];
  let i = 0;
  while (i < scored.length) {
    let j = i + 1;
    while (j < scored.length && scored[i].rank - scored[j].rank < EPS) j++;
    const cluster = scored.slice(i, j);
    if (cluster.length > 1) {
      cluster.sort((a, b) => rot(a.pick.perfume.id) - rot(b.pick.perfume.id));
    }
    for (const c of cluster) ranked.push(c.pick);
    i = j;
  }

  // 主推位的一票否决：轮换新鲜度是排序因子，不是"适不适合今天"的判断。
  // 昨天刚喷过 → freshness ≈ 0.58，这个 -42% 的降权远大于任何内容分差距，
  // 于是"库里最合适的那瓶"被压下去、被自己判了 avoid 的那瓶浮上来当主推——
  // 卡片右上角挂着「今天不建议」，解释开头写着「说实话，今天不太建议用它」。
  // 排序照旧，但主推必须跳过 avoid：宁可推第二合适的，也不当场自相矛盾。
  const firstOk = ranked.find((r) => r.verdict !== "avoid") ?? null;
  // 全柜今天没有一瓶合适，是一个**真实且必须说出口**的结论，不是一个要遮掩的边界情况。
  // 此前用 `?? ranked[0]` 兜底，把上面这段注释明令禁止的自相矛盾又放了回来：
  // 卡片眉标写着「今日之选」，正文写着「说实话，今天不太建议用它」，下面照挂喷量与留香。
  // 现在把这件事升成一个状态交给 UI（见 app/page.tsx 的 allAvoid 分支）：
  // 依然给出"真要用就这么用"的那一瓶，但绝不把它称作今日之选。
  const allAvoid = ranked.length > 0 && firstOk === null;
  const primary = firstOk ?? ranked[0] ?? null;
  // 注意：primary 不再必然是 ranked[0]，rest 只能按身份剔除，不能再用 slice(1)
  //
  // 备选同样要过 avoid 滤网。一票否决此前只做了主推位，备选位漏了——
  // 实测 300 组随机香柜 × 随机情境，42.7% 的情境里「也可以考虑」至少有一瓶是引擎自己判
  // 「今天不建议」的，而 AltList 根本不显示裁决，用户点下去就是采纳、直接记进香历。
  // 「也可以考虑」这个标题下面不该出现产品自己反对的选项；不足 3 条就少给，备选不必凑满。
  // 例外是全柜皆 avoid：那时滤掉就一条不剩，反而不如把同样处境的其它瓶列出来让人自己挑。
  const rest = primary
    ? ranked.filter((r) => r !== primary && (allAvoid || r.verdict !== "avoid"))
    : [];
  const alternatives: ScoredPick[] = [];
  const usedBrand = new Set(primary ? [primary.perfume.brand] : []);
  // 第一趟：优先换品牌，制造"另一种选择"的感觉
  for (const pk of rest) {
    if (alternatives.length >= 3) break;
    if (usedBrand.has(pk.perfume.brand)) continue;
    usedBrand.add(pk.perfume.brand);
    alternatives.push(pk);
  }
  // 第二趟：按分补满到 3（含同品牌），确保不丢全库第 2 名、也不凑不满
  for (const pk of rest) {
    if (alternatives.length >= 3) break;
    if (alternatives.includes(pk)) continue;
    alternatives.push(pk);
  }
  return { primary, alternatives, ranked, allAvoid };
}

// 由反馈聚合为个人偏置（简单、可感、不需大数据）。
// 设计要点：① 正负双向信号 + 按月轻度衰减（口味会变，偏置不能只增不减、锁死不动）；
// ② 环境归因过的"淡了"不进喷量校准（那笔算天气的）；③「刚好」沉淀成功配置，供同情境直接复用。
export function aggregateBias(feedbacks: Feedback[], now = Date.now()): Map<number, Bias> {
  const grouped = new Map<number, Feedback[]>();
  for (const f of feedbacks) {
    if (!grouped.has(f.perfumeId)) grouped.set(f.perfumeId, []);
    grouped.get(f.perfumeId)!.push(f);
  }
  const map = new Map<number, Bias>();
  for (const [id, fs] of grouped) {
    let like = 0;
    let strength = 0;
    const mismatch: Partial<Record<Occasion, number>> = {};
    const configs: SuccessConfig[] = [];
    for (const f of fs) {
      const months = Math.max(0, (now - f.at) / (30 * DAY_MS));
      const w = Math.pow(0.9, months); // 按月衰减：三个月前的反馈只剩七成话语权
      if (f.rating === "perfect") {
        like += 0.3 * w;
        if (f.sprays) {
          const mid = Math.round((f.sprays[0] + f.sprays[1]) / 2);
          const band = tempBand(f.context.tempC);
          // 同 (场合, 温度档) 只留最新一条
          const at = configs.findIndex((c) => c.occasion === f.context.occasion && c.tempBand === band);
          const cfg: SuccessConfig = { occasion: f.context.occasion, tempBand: band, sprays: Math.max(1, Math.min(5, mid)) };
          if (at >= 0) configs[at] = cfg;
          else configs.push(cfg);
        }
      } else if (f.rating === "too_strong") {
        strength += 0.4 * w;
        like -= 0.1 * w;
      } else if (f.rating === "too_weak") {
        // 两类"淡了"都不进喷量校准：
        // · env_attributed —— 高温/闷湿天是天气吃掉了留香，不算这瓶的喷量问题；
        // · adaptation_attributed —— 连着穿同一瓶时，先失灵的是鼻子而不是香水。
        //   把它换算成"多喷一点"，等于在一个已经失真的信号上加杠杆：
        //   闻不到→多喷→适应更深→还是闻不到，而周围人闻到的浓度一路上升。
        const attributed =
          f.tags?.includes("env_attributed") || f.tags?.includes("adaptation_attributed");
        if (!attributed) {
          strength -= 0.4 * w;
          like -= 0.05 * w;
        }
      } else if (f.rating === "scene_mismatch") {
        like -= 0.15 * w;
        // 与同一循环里的 like / strength 一样乘 w：注释（scoring.ts:mismatchMul）写着
        // 「反向反馈可抵消」，而这里此前是纯计数、既不衰减也不可抵消——半年前的一次
        // 「不合场合」和昨天的一次话语权相同，且永远抵不掉。
        mismatch[f.context.occasion] = (mismatch[f.context.occasion] ?? 0) + w;
      }
      // 同一场合后来又说过「刚好」，就是那句「反向反馈」本身：把它抵掉，下限 0。
      if (f.rating === "perfect") {
        const occ = f.context.occasion;
        if (mismatch[occ] != null) mismatch[occ] = Math.max(0, mismatch[occ]! - w);
      }
    }
    // 被抵干净或衰减到接近零的场合直接丢掉，别留一个恒等于 1 的乘子占位
    for (const k of Object.keys(mismatch) as Occasion[]) {
      if ((mismatch[k] ?? 0) < 0.05) delete mismatch[k];
    }
    map.set(id, {
      likeScore: Math.max(-1, Math.min(1, like)),
      perceivedStrength: Math.max(-1, Math.min(1, strength)),
      sceneMismatch: Object.keys(mismatch).length ? mismatch : undefined,
      successConfigs: configs.length ? configs.slice(-5) : undefined,
    });
  }
  return map;
}
