// 发现型钩子的纯函数层：吃灰提醒(S5) + 天气突变预警(S4)——产品自称的价值重心。
//
// 单独成文件有两个理由：
//   ① 它此前长在 hooks.ts 里，而 hooks.ts 为了 useApp 反向 import 了 src/components，
//      于是全应用分支最密的这段逻辑（吃灰筛选 / 冷启动兜底 / better 要同时排除三瓶 /
//      无香场合不弹卡）被关在 node --test 够不着的地方——只能靠线上发现问题。
//      历史上「换成你已经拿到的那瓶」就是这么漏出去的。
//   ② now 变成入参，这段逻辑就是确定性的：同样的输入必得同样的卡片，可以逐条断言。
import type { Context, Perfume, ScoredPick, AvoidCause, UserPerfume, Feedback } from "./types";
import { buildPick, aggregateBias, type recommend } from "./recommend";

export type Nudge =
  | { kind: "dusty"; perfume: Perfume; days: number; pick: ScoredPick }
  | {
      kind: "weather";
      habitual: Perfume;
      better: Perfume | null;
      reason: string;
      basis: "habit" | "cold";
      /** 为什么不建议——眉标由它决定，不许再写死「天气突变」（见 NudgeCard） */
      cause: Exclude<AvoidCause, "fragrance_free">;
    };

const DAY_MS = 24 * 3600 * 1000;
export const DUSTY_MS = 21 * DAY_MS; // 用过但很久没碰（全应用统一口径：吃灰=21 天）
const NEVER_MS = 14 * DAY_MS; // 从没用过、入柜超两周

// risks 为空时的兜底措辞。也必须按成因分岔——
// 原来无论什么成因都写「今天的天气不太适合它」，正是眉标那个错误的同一处根因。
const CAUSE_FALLBACK_REASON: Record<Exclude<AvoidCause, "fragrance_free">, string> = {
  weather: "今天的体感对它不太友好",
  season: "它更偏另一个季节，今天用会有点反季",
  venue: "它的扩散偏强，今天这类封闭场合容易过头",
};

export interface NudgeInput {
  lib: Perfume[];
  userPerfumes: UserPerfume[];
  feedbacks: Feedback[];
  ctx: Context;
  rec: NonNullable<ReturnType<typeof recommend>>;
  now: number;
}

export function pickNudges({ lib, userPerfumes, feedbacks, ctx, rec, now }: NudgeInput): Nudge[] {
  const bias = aggregateBias(feedbacks);
  const primaryId = rec.primary?.perfume.id;
  const byId = new Map(lib.map((p) => [p.id, p]));
  const uById = new Map(userPerfumes.map((u) => [u.perfumeId, u]));
  const hasHistory = feedbacks.length >= 2; // 已有用香习惯
  const nudges: Nudge[] = [];

  // S5 吃灰提醒：搁置已久、但今天恰好合适(verdict good)、且不是今天的主推
  const dusty = lib
    .filter((p) => {
      const u = uById.get(p.id);
      if (!u) return false;
      if (u.lastWornAt) return now - u.lastWornAt > DUSTY_MS;
      // 从没用过：入柜超两周；或已有用香习惯却独独没碰它、入柜超 3 天（冷启动更早触发）
      return now - u.addedAt > NEVER_MS || (hasHistory && now - u.addedAt > 3 * DAY_MS);
    })
    .map((p) => {
      const u = uById.get(p.id)!;
      return { p, u, pick: buildPick(p, ctx, bias.get(p.id)) };
    })
    .filter((x) => x.pick.verdict === "good" && x.p.id !== primaryId)
    .sort((a, b) => b.pick.score - a.pick.score);

  if (dusty[0]) {
    const { p, u, pick } = dusty[0];
    const last = u.lastWornAt ?? u.addedAt;
    nudges.push({ kind: "dusty", perfume: p, days: Math.round((now - last) / DAY_MS), pick });
  }

  // S4 天气突变预警：依赖真实天气——近似天气态(定位失败降级)下不弹，避免用人造体感冒充"天气突变预警"
  if (ctx.approximate) return nudges;

  // "常喷"用真实穿戴信号 wornCount(换香/吃灰采纳/反馈提交累计≥2次，同日去重)，而非反馈计数——feedback 稀疏、口径失真
  let habitualId: number | null = null;
  let maxWorn = 1;
  for (const u of userPerfumes) {
    const c = u.wornCount ?? 0;
    if (c > maxWorn && byId.has(u.perfumeId)) {
      maxWorn = c;
      habitualId = u.perfumeId;
    }
  }
  let basis: "habit" | "cold" = habitualId != null ? "habit" : "cold";
  // 冷启动兜底：还没形成用香习惯时，退回"库里今天最相关、却被判 avoid 的那瓶"——让旗舰钩子第一周不哑火
  if (habitualId == null) {
    const flagged = rec.ranked.find((r) => r.verdict === "avoid" && r.perfume.id !== primaryId);
    if (flagged) {
      habitualId = flagged.perfume.id;
      basis = "cold"; // 不是"常喷"，只是今天库里被判不宜的一瓶 → 文案不能冒称个性化
    }
  }
  if (habitualId == null || habitualId === primaryId) return nudges;

  const hp = buildPick(byId.get(habitualId)!, ctx, bias.get(habitualId));
  // 柜里每一瓶都是 avoid 时，这张卡会退化成"随便点一瓶说它不合适"——
  // 而主推卡此时已经把「今天没有合适的」整件事说完了，再叠一张只是噪音。
  //
  // 守卫此前只排除了 fragrance_free，可注释描述的退化条件是"柜里每一瓶都是 avoid"，
  // 这在天气 / 反季 / 场地成因下同样成立：冬香为主的柜在夏天会出现主推卡眉标
  //「今天柜里没有合适的」，紧挨着一张预警卡再挑一瓶说「这瓶今天要留意」，
  // 且因为柜里没有 good 而没有任何可点按钮——没有新信息也没有出路。
  // recommend 早就把这件事算成 allAvoid 交给 UI 了，这里认它。
  if (rec.allAvoid || hp.verdict !== "avoid" || hp.avoidCause === null || hp.avoidCause === "fragrance_free") {
    return nudges;
  }

  // 必须排除主推：预警卡就浮在推荐卡上方，"换成 X 更合适"里的 X 若正是下面那瓶主推，
  // 等于让用户去换成他已经拿到的答案。没有第三瓶可换时宁可不给按钮——预警本身已经成立。
  //
  // 同样要排除吃灰卡刚推过的那瓶：两张卡是上下相邻的，一张说"把蓝风铃翻出来"、
  // 另一张说"换成蓝风铃更合适"，等于同一个建议说了两遍，还让人以为是两件事。
  // 这与上面那条排除主推是同一条规则——一屏之内，同一瓶只该被推荐一次。
  const dustyId = dusty[0]?.p.id ?? null;
  const better =
    rec.ranked.find(
      (r) =>
        r.verdict === "good" &&
        r.perfume.id !== habitualId &&
        r.perfume.id !== primaryId &&
        r.perfume.id !== dustyId
    )?.perfume ?? null;

  nudges.push({
    kind: "weather",
    habitual: byId.get(habitualId)!,
    better,
    // 正文必须与眉标同源：avoidRisk 就是触发这次 avoid 的那一条风险原文。
    // 取 risks[0] 会让眉标写「季节不对」、正文却在讲高温——两句各自都为真，
    // 归因链却断了，而这张卡正印在 README 首屏那张图上。
    reason: hp.avoidRisk ?? CAUSE_FALLBACK_REASON[hp.avoidCause],
    basis,
    cause: hp.avoidCause,
  });
  return nudges;
}
