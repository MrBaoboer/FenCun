// 推荐编排：打分 → 轮换加权 → 排序 → 主推 + 备选，并为每个候选附上用法/风险/理由/裁决
import type { Perfume, Context, ScoredPick, Verdict, Bias, Feedback, Occasion, SuccessConfig } from "./types";
import { score, type ScoreParts } from "./scoring";
import { computeUsage, computeRisks, buildReasons } from "./usage";
import { tempBand } from "./season";

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
function computeVerdict(p: Perfume, ctx: Context, parts: ScoreParts, risks: string[]): Verdict {
  const entries = Object.entries(p.seasonPct) as [keyof typeof p.seasonPct, number][];
  const best = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const seasonMiss = best[0] !== ctx.season && best[1] - p.seasonPct[ctx.season] >= 0.22;
  const closed = ctx.occasion === "commute" || ctx.occasion === "work" || ctx.occasion === "formal";
  const tooLoudClosed = p.sillageTier === 4 && closed;
  if (parts.weather <= 0.82 || seasonMiss || tooLoudClosed) return "avoid";
  if (risks.length > 0 || parts.weather < 0.95) return "caution";
  return "good";
}

export function buildPick(p: Perfume, ctx: Context, bias?: Bias): ScoredPick {
  const parts = score(p, ctx, bias);
  const risks = computeRisks(p, ctx);
  const usage = computeUsage(p, ctx, bias);
  const reasons = buildReasons(p, ctx, {
    season: parts.season,
    weather: parts.weather,
    occasion: parts.occasion,
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
    verdict: computeVerdict(p, ctx, parts, risks),
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
): { primary: ScoredPick | null; alternatives: ScoredPick[]; ranked: ScoredPick[] } {
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

  const primary = ranked[0] ?? null;
  const rest = ranked.slice(1);
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
  return { primary, alternatives, ranked };
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
        // 环境归因：高温/闷湿天的"淡了"是天气吃掉了留香，不算这瓶的喷量问题
        if (!f.tags?.includes("env_attributed")) {
          strength -= 0.4 * w;
          like -= 0.05 * w;
        }
      } else if (f.rating === "scene_mismatch") {
        like -= 0.15 * w;
        mismatch[f.context.occasion] = (mismatch[f.context.occasion] ?? 0) + 1;
      }
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
