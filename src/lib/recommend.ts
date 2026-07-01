// 推荐编排：打分 → 排序 → 主推 + 备选，并为每个候选附上用法/风险/理由/裁决
import type { Perfume, Context, ScoredPick, Verdict } from "./types";
import { score, type ScoreParts } from "./scoring";
import { computeUsage, computeRisks, buildReasons } from "./usage";

export interface Bias {
  likeScore: number;
  perceivedStrength: number;
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
    usage: computeUsage(p, ctx),
    risks,
    reasons: buildReasons(p, ctx, {
      season: parts.season,
      weather: parts.weather,
      occasion: parts.occasion,
    }),
    verdict: computeVerdict(p, ctx, parts, risks),
  };
}

export function recommend(
  perfumes: Perfume[],
  ctx: Context,
  biasMap?: Map<number, Bias>
): { primary: ScoredPick | null; alternatives: ScoredPick[]; ranked: ScoredPick[] } {
  const ranked = perfumes
    .map((p) => buildPick(p, ctx, biasMap?.get(p.id)))
    .sort((a, b) => b.score - a.score);

  const primary = ranked[0] ?? null;
  const alternatives: ScoredPick[] = [];
  const seenBrand = new Set(primary ? [primary.perfume.brand] : []);
  // 备选优先换品牌，制造"另一种选择"的感觉
  for (const pk of ranked.slice(1)) {
    if (alternatives.length >= 3) break;
    if (seenBrand.has(pk.perfume.brand) && alternatives.length < 2) continue;
    seenBrand.add(pk.perfume.brand);
    alternatives.push(pk);
  }
  while (alternatives.length < 3 && ranked.length > alternatives.length + 1) {
    const pk = ranked[alternatives.length + 1];
    if (pk && !alternatives.includes(pk) && pk !== primary) alternatives.push(pk);
    else break;
  }
  return { primary, alternatives, ranked };
}

// 由反馈聚合为个人偏置（简单、可感、不需大数据）
import type { Feedback } from "./types";
export function aggregateBias(feedbacks: Feedback[]): Map<number, Bias> {
  const map = new Map<number, Bias>();
  const grouped = new Map<number, Feedback[]>();
  for (const f of feedbacks) {
    if (!grouped.has(f.perfumeId)) grouped.set(f.perfumeId, []);
    grouped.get(f.perfumeId)!.push(f);
  }
  for (const [id, fs] of grouped) {
    let like = 0;
    let strength = 0;
    for (const f of fs) {
      if (f.rating === "perfect") like += 0.3;
      if (f.rating === "too_strong") strength += 0.4;
      if (f.rating === "too_weak") strength -= 0.4;
    }
    map.set(id, {
      likeScore: Math.max(-1, Math.min(1, like)),
      perceivedStrength: Math.max(-1, Math.min(1, strength)),
    });
  }
  return map;
}
