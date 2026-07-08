// 用法计算器（规则，产品壁垒层）—— 喷量/部位/距离/留香/风险，全程区间档位
import type { Perfume, Context, Usage, Bias } from "./types";
import { durationHint, SEASON_NAME } from "./format";
import { tempBand } from "./season";

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

function accStrength(p: Perfume, en: string): number {
  const a = p.accords.find((x) => x.en === en);
  return a ? a.strength : 0;
}

// 「用力过猛」组合：甜重/浓白花 × 强扩散 × 通勤会议类场合——国内语境下最容易被负面评价的搭配
function overdressedCombo(p: Perfume, ctx: Context): boolean {
  const loudSweet = Math.max(accStrength(p, "sweet"), accStrength(p, "vanilla")) >= 50;
  const loudFloral = accStrength(p, "white floral") >= 50;
  const officeish = ctx.occasion === "commute" || ctx.occasion === "work" || ctx.occasion === "formal";
  return (loudSweet || loudFloral) && p.sillageTier >= 3 && officeish;
}

export function computeUsage(p: Perfume, ctx: Context, bias?: Bias): Usage {
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
  // 冷天清淡香可略增；闷热重香压一档（强扩散香在湿热天更容易发闷、放大存在感）
  if (ctx.feel === "cold" && sil < 2.4) hi = Math.min(hi + 1, 5);
  if (ctx.feel === "hot_humid" && sil >= 3.2) hi = Math.max(lo, hi - 1);
  // 餐桌场合：气味干扰味觉，收一档
  if (ctx.meal) hi = Math.max(lo, hi - 1);
  // 甜重/浓白花 × 强扩散 × 通勤会议：容易显得用力过猛，压到最低档
  if (overdressedCombo(p, ctx)) {
    lo = 1;
    hi = Math.max(1, Math.min(hi, 2) - 1) || 1;
  }
  // 自然语言场景：想贴身则收一档、想被注意到可略增
  if (ctx.intimacy === "close") hi = Math.max(lo, hi - 1);
  if (ctx.intimacy === "broadcast") hi = Math.min(hi + 1, 5);
  if (ctx.avoid?.includes("too_strong")) {
    lo = Math.max(1, lo - 1);
    hi = Math.max(lo, hi - 1);
  }
  // 反馈闭环：你多次觉得"太冲"(perceivedStrength>0)→少喷；"太淡"(<0)→多喷。兑现"下次帮你少喷半下"
  const ps = bias?.perceivedStrength ?? 0;
  if (ps >= 0.4) {
    hi = Math.max(1, hi - 1);
    if (ps >= 0.7) lo = Math.max(1, lo - 1);
  } else if (ps <= -0.4) {
    hi = Math.min(hi + 1, 5);
  }
  // 不变式收口：任何修正路径都不允许出现 "2–1 下" 这种反向区间
  lo = Math.max(1, Math.min(lo, hi));
  hi = Math.max(lo, hi);

  // 成功配置复用：同温度档 × 同场合你反馈过「刚好」→ 跳过通用规则，直接按那次的量来。
  // 校准必须被感知（note 会显示出来）——"越用越懂你"不能是静默的
  let note: string | undefined;
  const cfg = bias?.successConfigs?.find(
    (c) => c.occasion === ctx.occasion && c.tempBand === tempBand(ctx.tempC)
  );
  if (cfg) {
    lo = hi = Math.max(1, Math.min(5, cfg.sprays));
    note = "上次同样天气、同样场合你说「刚好」——就按那次的量来。";
  }

  const spraysLabel = lo === hi ? `${lo} 下` : `${lo}–${hi} 下`;

  // 喷洒位置
  let placement: string[];
  if (ctx.intimacy === "close") placement = ["手腕", "颈侧贴身"];
  else if (density === "closed" || density === "dense") placement = ["手腕", "衣物内侧"];
  else if (ctx.occasion === "date") placement = ["颈侧", "手腕", "发梢少量"];
  else if (ctx.occasion === "social") placement = ["颈侧", "胸口"];
  else placement = ["手腕", "颈侧"];
  // 闷热潮湿：不只挪手腕——颈侧/胸口是脉搏+出汗区，高温加速挥发、易发闷酸，一并降到低出汗部位；去发梢
  if (ctx.feel === "hot_humid") {
    placement = placement
      .map((x) =>
        x === "手腕"
          ? "衣物内侧"
          : x === "颈侧" || x === "颈侧贴身"
          ? "耳后 / 衣领内侧"
          : x === "胸口"
          ? "衣物内侧"
          : x
      )
      .filter((x) => x !== "发梢少量");
    placement = Array.from(new Set(placement));
    if (placement.length === 0) placement = ["衣物内侧"];
  }
  // 用力过猛组合：位置整体放低——热空气自下而上，浓香从腰以下缓释才体面
  if (overdressedCombo(p, ctx)) placement = ["腰侧", "衣物下摆内侧"];

  // 社交距离取「喷后有效档」而非原始扩散：已生效的减档（封闭/贴身/嫌冲/闷热压量）都会降低实际投射，
  // 封顶降 2 档，避免同屏出现「喷 1 下」却仍标「整间屋都是它」的自相矛盾。
  let distReduce = 0;
  if (density === "dense" || density === "closed") distReduce++;
  if (ctx.intimacy === "close") distReduce++;
  if (ctx.avoid?.includes("too_strong")) distReduce++;
  if (ps >= 0.4) distReduce++;
  const effTier = Math.max(1, p.sillageTier - Math.min(distReduce, 2)) as 1 | 2 | 3 | 4;

  const risks = computeRisks(p, ctx);

  // 留香提示：在场时间不短 + 这瓶偏短效 → 提醒带分装（时长来自场景解析的档位值，不精确到小时）
  let dHint = durationHint(p.longevity);
  if ((ctx.duration ?? 0) >= 6 && (p.longevity ?? 3) < 3) {
    dHint += "；在外时间不短，带上分装中途补 1 下更稳";
  }

  return {
    sprays: [lo, hi],
    spraysLabel,
    placement,
    socialDistance: effTier,
    durationHint: dHint,
    suitable: risks.length === 0,
    note,
  };
}

export function computeRisks(p: Perfume, ctx: Context): string[] {
  const risks: string[] = [];
  const density = DENSITY[ctx.occasion] ?? "normal";

  if (p.sillageTier >= 4 && (density === "closed" || density === "dense")) {
    risks.push("空间偏封闭、人也多，这瓶气场较大——建议只喷 1 下，或换一瓶更贴肤的。");
  }
  const sweetAmber = Math.max(accStrength(p, "sweet"), accStrength(p, "amber"), accStrength(p, "vanilla"));
  if (ctx.feel === "hot_humid" && sweetAmber >= 55) {
    risks.push("今天又热又潮，它偏甜重，上身久了容易发腻，可考虑换清爽些的。");
  }
  // 餐桌场合：浓香/甜香和食物气味打架（高端餐饮甚至明示谢绝浓香）
  if (ctx.meal && (sweetAmber >= 55 || p.sillageTier >= 3)) {
    risks.push("这顿饭是场合的一部分——它的存在感会和食物气味打架，喷得比平时更收着些。");
  }
  // 「用力过猛」组合提示（国内语境：办公室里的浓甜白花有"柜姐感"联想）
  if (overdressedCombo(p, ctx)) {
    risks.push("甜和扩散都偏高，这类场合容易显得用力过猛——压到 1 下、放低位置会体面很多。");
  }
  // 季节错配：相对差，不用绝对阈值
  const entries = Object.entries(p.seasonPct) as [keyof typeof p.seasonPct, number][];
  const best = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const cur = p.seasonPct[ctx.season];
  if (best[0] !== ctx.season && best[1] - cur >= 0.12) {
    const map: Record<string, string> = { winter: "冬", spring: "春", summer: "夏", autumn: "秋" };
    risks.push(`大家更多在${map[best[0]]}季用它，今天用会有点反季。`);
  }
  // 场景解析给出的社交风险（LLM 的场景常识以受控字段进入，不允许它自由发挥进正文）
  if (ctx.riskNote && !risks.some((r) => r.includes(ctx.riskNote!))) {
    risks.push(ctx.riskNote.endsWith("。") ? ctx.riskNote : ctx.riskNote + "。");
  }
  return risks;
}

// 规则生成的"为什么"要点 —— 同时作为 DeepSeek 解释不可用时的兜底
export function buildReasons(p: Perfume, ctx: Context, parts: { season: number; weather: number; occasion: number }): string[] {
  const r: string[] = [];
  const topAccords = p.accords.slice(0, 3).map((a) => a.zh).join("·");
  if (parts.season >= 0.85) r.push(`正是它的主场季——社区投票里它更偏${SEASON_NAME[ctx.season]}`);
  if (parts.weather >= 1.08) r.push(`${topAccords}的调性清爽通透，正合今天的天气`);
  else if (parts.weather <= 0.92) r.push(`它偏厚重，今天的体感里要留意会不会闷`);
  if (parts.occasion >= 0.8) r.push(`风格（${p.styleTags.join("·")}）贴合${ctx.occasion === "date" ? "约会" : "今天的场合"}`);
  if (p.custom) r.push(`这瓶是你手动记录的，按所选香调的典型情况估计，用两次并反馈后会更准`);
  else if (p.lowVotes) r.push(`这瓶的社区数据还少，判断偏保守，你的反馈会让它更准`);
  if (r.length === 0) r.push(`${topAccords}的整体气质，和今天比较合拍`);
  return r;
}
