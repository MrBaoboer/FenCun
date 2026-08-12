// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

// 场合先验 —— 刻意与打分引擎分文件存放。
//
// ════════════════════════════════════════════════════════════════════════
//  这个文件里**没有一个数字有科学依据**。这不是免责声明，是这个文件存在的理由。
// ════════════════════════════════════════════════════════════════════════
//
// 循证复核的结论很直接：「职场偏清爽木质、约会偏甜花、运动要清新」这类命题，
// **检索不到任何同行评议的消费者研究**。它们是文化建构与社交惯例，不是科学；
// 而且强烈依赖地域——中东市场对沉香在正式场合的接受度与东亚完全不同，
// 中国职场规范更是零数据。
//
// 那为什么还留着？因为**这正是产品要提供的东西**。用户打开氛寸，要的就是
// "一个懂行的人会怎么选"，不是一份文献综述。删掉它们，产品就没有判断了。
//
// 所以规矩只有两条：
//   ① **不许对用户宣称它有科学依据。** 文案只说"这类场合一般更稳妥"，
//      绝不说"研究表明"。见 docs/领域规则手册.md §4.3 文案纪律。
//   ② **不许为了"更精确"去微调这些数。** 把一个没依据的数换成另一个没依据的数，
//      是退步不是进步。要改，唯一正确的路径是收集真实用户反馈做 A/B。
//
// 系数一律只保留一位小数——这是刻意的：两位小数会让人误以为它们被标定过。
// 0.4 就是"挺重要"，0.2 就是"有点影响"，仅此而已。
//
// ⚠️ 注意区分：本文件只装**风格偏好**（B 类）。与之相对的**安全与礼仪**（A 类）
// 留在 scoring.ts / usage.ts 里，因为它们有扎实的公共卫生依据：约三分之一人群
// 报告对香味制品有不良反应，CDC / CCOHS / CDPH / 美国肺脏协会均有正式无香政策。
// 「强扩散香在封闭场合扣分」「密闭场合减喷量」属于 A 类，理直气壮，不要挪进来。

/**
 * 场合的空间密度。**这是「封闭场合」这个概念在全仓的唯一定义。**
 *
 * 它此前有三份各写一遍的判据：usage.ts 的 DENSITY 表、同文件 overdressedCombo 里的
 * `officeish`、以及 recommend.ts computeVerdict 里的 `closed`。三处的枚举列表
 * 恰好一致，但那是巧合不是保证——加一个新场合时漏改任意一处，
 * 就会出现「按封闭场合减了喷量、却不按封闭场合判裁决」这类分家。
 * 本仓库自己写下的纪律是同一个概念只准有一处判据，这里补上。
 */
export const DENSITY: Record<string, "dense" | "closed" | "normal" | "open"> = {
  commute: "dense",
  work: "closed",
  formal: "closed",
  date: "normal",
  social: "normal",
  casual: "normal",
  home: "open",
  sport: "open",
};

/** 人多且不通风：通勤 / 上班 / 正式。喷量、裁决与「用力过猛」判定共用这一条 */
export function isClosedOccasion(occasion: string): boolean {
  const d = DENSITY[occasion];
  return d === "dense" || d === "closed";
}

/** 各家族在加/扣分时的相对折扣（例：正式场合看重"干净木质"但不希望它太张扬 → 0.8） */
export const FAMILY_DISCOUNT = {
  formalAmberWoody: 0.8,
  formalSpicy: 0.6,
  dateSpicy: 0.5,
  relaxed: 0.6,
} as const;

/**
 * 场合 → 风格倾向权重。数字含义：
 *   0.4 = 这个场合里这一族是主要加分项
 *   0.2 = 有影响但不主导
 *   0.1 = 轻微
 * 都是一位小数，因为我们只知道量级，不知道数值。
 */
export const OCCASION_WEIGHTS = {
  /** 约会 / 聚会：甜与花讨喜；泥土皮革烟草不浪漫；纯清冽不够暧昧 */
  romantic: {
    favorSweetFloral: 0.4,
    favorWarmWood: 0.1,
    againstEarthyDark: 0.3,
    penaltyTooFresh: 0.2, // 极清冽且无甜无花
  },
  /** 正式 / 上班 / 通勤：干净木质柑橘草本；反甜、反花、反脏气 */
  proper: {
    favorCleanWoodFresh: 0.3,
    againstSweet: 0.4,
    againstFloral: 0.2,
    againstEarthyDark: 0.2,
  },
  /** 运动：清爽为王，强烈反甜反重 */
  sport: {
    favorFresh: 0.4,
    againstHeavy: 0.5,
  },
  /**
   * 居家 / 休闲：柔和舒适皆可，只反强扩散。
   *
   * ⚠️ 如实记一笔：occasionFit 在这一支上取的是「甜 ∪ 琥珀木质 ∪ 清冽 ∪ 花」的最大值，
   * 而这四族的并集几乎覆盖每瓶香的首位 accord——实测 77% 的库存在这里恒得同一个数。
   * 也就是说**这个场合我们没有风格判断**：这一项对全部候选弃权，不改变任何排序。
   * 那正是上面那句"柔和舒适皆可"的字面意思，不是缺陷；写在这里是为了让下一个人
   * 不必重新测一遍才知道。要造一条区分力出来，得先有依据（见文件头的两条纪律）。
   * 同理 home 与 casual 在全引擎逐字节等价——八个 chip 里有两个切了没区别。
   */
  relaxed: {
    favorAny: 0.2,
  },
} as const;

/**
 * 「强扩散香在这个场合本身就是问题」的扣分。
 * ⚠️ 这一条**不是**文化惯例，是 A 类安全项——它的依据是公共卫生而非审美。
 * 放在这里只是为了和上面的权重表放在一起读；改动它要按 A 类的标准对待。
 */
export const LOUD_PENALTY = {
  formal: 0.2,
  date: 0.2,
  sport: 0.1,
  relaxed: 0.2,
} as const;
