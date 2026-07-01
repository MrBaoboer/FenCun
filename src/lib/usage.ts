// 用法计算器（规则，产品壁垒层）—— 喷量/部位/距离/留香/风险，全程区间档位
import type { Perfume, Context, Usage } from "./types";
import { durationHint, SEASON_NAME } from "./format";

// 场景的空间密度（影响喷量与风险）
const DENSITY: Record<string, "dense" | "closed" | "normal" | "open"> = {
  commute: "dense",
  work: "closed",
  formal: "closed",
  date: "normal",
  social: "normal",
  casual: "normal",
  home: "open",
  sport: "open",
};

export function computeUsage(p: Perfume, ctx: Context): Usage {
  const sil = p.sillage ?? 2.5;
  // 喷量基础档：扩散越强，喷越少
  let lo: number, hi: number;
  if (sil >= 3.2) [lo, hi] = [1, 2];
  else if (sil >= 2.4) [lo, hi] = [2, 3];
  else [lo, hi] = [3, 4];

  const density = DENSITY[ctx.occasion] ?? "normal";
  if (density === "dense" || density === "closed") {
    lo = Math.max(1, lo - 1);
    hi = Math.max(lo, hi - 1);
  } else if (density === "open" && ctx.occasion === "sport") {
    // 运动留香易散，但不鼓励多喷，维持
  }
  // 冷天清淡香可略增；闷热重香压一档
  if (ctx.feel === "cold" && sil < 2.4) hi = Math.min(hi + 1, 5);
  if (ctx.feel === "hot_humid" && sil >= 3.2) lo = Math.max(1, lo);
  // 自然语言场景：想贴身则收一档、想被注意到可略增
  if (ctx.intimacy === "close") hi = Math.max(lo, hi - 1);
  if (ctx.intimacy === "broadcast") hi = Math.min(hi + 1, 5);
  if (ctx.avoid?.includes("too_strong")) {
    lo = Math.max(1, lo - 1);
    hi = Math.max(lo, hi - 1);
  }

  const spraysLabel = lo === hi ? `${lo} 下` : `${lo}–${hi} 下`;

  // 喷洒位置
  let placement: string[];
  if (ctx.intimacy === "close") placement = ["手腕", "颈侧贴身"];
  else if (density === "closed" || density === "dense") placement = ["手腕", "衣物内侧"];
  else if (ctx.occasion === "date") placement = ["颈侧", "手腕", "发梢少量"];
  else if (ctx.occasion === "social") placement = ["颈侧", "胸口"];
  else placement = ["手腕", "颈侧"];
  if (ctx.feel === "hot_humid") placement = placement.map((x) => (x === "手腕" ? "衣物（手腕高温会加速挥发）" : x));

  const risks = computeRisks(p, ctx);

  return {
    sprays: [lo, hi],
    spraysLabel,
    placement,
    socialDistance: p.sillageTier,
    durationHint: durationHint(p.longevity),
    suitable: risks.length === 0,
  };
}

function accStrength(p: Perfume, en: string): number {
  const a = p.accords.find((x) => x.en === en);
  return a ? a.strength : 0;
}

export function computeRisks(p: Perfume, ctx: Context): string[] {
  const risks: string[] = [];
  const density = DENSITY[ctx.occasion] ?? "normal";

  if (p.sillageTier >= 4 && (density === "closed" || density === "dense")) {
    risks.push("空间偏封闭、人也多，这瓶气场较大——建议只喷 1 下，或换一瓶更贴肤的。");
  }
  const sweetAmber = Math.max(accStrength(p, "sweet"), accStrength(p, "amber"), accStrength(p, "vanilla"));
  if (ctx.feel === "hot_humid" && sweetAmber >= 55) {
    risks.push("今天又热又潮，它偏甜重，久戴可能发腻，可考虑换清爽些的。");
  }
  // 季节错配：相对差，不用绝对阈值
  const entries = Object.entries(p.seasonPct) as [keyof typeof p.seasonPct, number][];
  const best = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const cur = p.seasonPct[ctx.season];
  if (best[0] !== ctx.season && best[1] - cur >= 0.12) {
    const map: Record<string, string> = { winter: "冬", spring: "春", summer: "夏", autumn: "秋" };
    risks.push(`大家更多在${map[best[0]]}季用它，今天用会有点反季。`);
  }
  return risks;
}

// 规则生成的"为什么"要点 —— 同时作为 DeepSeek 解释不可用时的兜底
export function buildReasons(p: Perfume, ctx: Context, parts: { season: number; weather: number; occasion: number }): string[] {
  const r: string[] = [];
  const topAccords = p.accords.slice(0, 3).map((a) => a.zh).join("·");
  if (parts.season >= 0.85) r.push(`正是它的主场季——社区投票里它更偏${SEASON_NAME[ctx.season]}`);
  if (parts.weather >= 1.08) r.push(`${topAccords}的调性清爽通透，扛得住今天的体感`);
  else if (parts.weather <= 0.92) r.push(`它偏厚重，今天的体感里要留意会不会闷`);
  if (parts.occasion >= 0.8) r.push(`风格(${p.styleTags.join("·")})贴合${ctx.occasion === "date" ? "约会" : "今天的场合"}`);
  if (r.length === 0) r.push(`${topAccords}的整体气质，和今天比较合拍`);
  return r;
}
