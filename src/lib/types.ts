// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

// 氛寸 · 核心类型契约

export interface Accord {
  en: string; // 英文键（供打分规则匹配）
  zh: string; // 中文（供展示）
  strength: number; // 0..100
}

export type Gender = "male" | "female" | "unisex";

export interface Perfume {
  id: number; // 目录/扩展集为 Fragrantica id；手动自建为负数（永不与数据集冲突）
  name: string; // 英文原名（锚点，永不丢弃）
  nameZh: string | null; // 中文名（官方名/公认绰号/直译；无则 null，展示回退英文）
  aliases: string[]; // 其他中文叫法/绰号，用于搜索命中
  brand: string;
  brandZh: string;
  gender: Gender;
  year: number | null;
  rating: number | null; // 1..5
  longevity: number | null; // 1..5  1弱5持久
  sillage: number | null; // 1..4  1贴肤 4外放
  sillageTier: 1 | 2 | 3 | 4;
  priceValue: number | null; // 1..5
  seasonPct: { winter: number; spring: number; summer: number; autumn: number };
  daypartPct: { day: number; night: number };
  accords: Accord[];
  notes: { top: string[]; middle: string[]; base: string[] };
  notesFlat: string[];
  styleTags: string[];
  popularity: number;
  people: number;
  lowVotes?: boolean; // 扩展集低票记录（汉字品牌补充放行等）：社区统计仅供参考
  custom?: boolean; // 用户手动记录：无社区数据，按所选香调的典型情况估计
}

export type Season = "winter" | "spring" | "summer" | "autumn";
export type Feel = "hot_humid" | "hot_dry" | "mild" | "cold";
export type Daypart = "day" | "night";
export type Occasion =
  | "commute"
  | "work"
  | "date"
  | "social"
  | "formal"
  | "casual"
  | "home"
  | "sport";

export interface Weather {
  tempC: number;
  humidity: number;
  /**
   * 刻意不消费的字段：取到了、也存着，引擎一处都不读。接口给的是 10m 高度的城市网格风，
   * 机制里起作用的是皮肤表面气流，两者基本解耦；风又同时稀释和输运烟羽，而相对方位拿不到。
   * 最危险的一步是把「密闭场合减 1 下」改写成 airflow 驱动——那会把一条诚实的礼仪规则
   * 伪装成有论文背书的物理规则。要动它，先读 docs/领域规则手册.md §1.1b。
   */
  windSpeed: number;
  text: string;
  city: string;
  approximate?: boolean; // 定位失败/降级时为 true
}

export interface Context {
  tempC: number;
  humidity: number;
  windSpeed: number;
  weatherText: string;
  city: string;
  feel: Feel;
  daypart: Daypart;
  season: Season;
  occasion: Occasion;
  formality?: number; // 0..1
  intimacy?: "close" | "neutral" | "broadcast";
  avoid?: string[]; // too_sweet | too_strong | too_formal | cloying | too_casual
  tension?: "none" | "low" | "high"; // 关系张力（前任婚礼/谈判…）——存在时用户一定愿意说
  duration?: 2 | 4 | 6 | 9; // 在场时长档位（只允许档位值，禁止精确小时——伪精确红线）
  meal?: boolean; // 餐桌场合：压制浓香/甜香的关键开关（气味干扰味觉）
  /**
   * 无香场合（就医 / 探病 / 体检 / 陪诊 / 化疗病房等）。
   * 这是全引擎依据最好的一条规则：约三分之一人群报告对香味制品有不良反应，
   * CDC、加州公共卫生部、CCOHS 等机构均有正式无香政策，多国医疗机构对访客有明确无香要求。
   * 命中时唯一正确的建议是「今天不用香」——这也是产品第一次说出"别用"。
   */
  fragranceFree?: boolean;
  riskNote?: string; // 场景解析给出的一句话社交风险，受控进入风险提示
  sceneLabel?: string; // 自然语言场景被解析后的人话摘要
  rawText?: string; // 用户原始输入
  approximate?: boolean;
}

// 自然语言场景 → 结构化补丁
export interface ScenePatch {
  occasion: Occasion;
  formality?: number;
  intimacy?: "close" | "neutral" | "broadcast";
  avoid?: string[];
  tension?: "none" | "low" | "high";
  duration?: 2 | 4 | 6 | 9;
  meal?: boolean;
  fragranceFree?: boolean; // 就医/探病等无香场合
  riskNote?: string;
  label: string; // 解析出的人话摘要
  rawText: string;
}

export interface Usage {
  sprays: [number, number]; // 区间档位，绝不给精确 ml
  spraysLabel: string;
  placement: string[];
  socialDistance: 1 | 2 | 3 | 4;
  durationHint: string; // 区间，绝不给小时数
  suitable: boolean;
  note?: string; // 个人化说明（如"按你上次「刚好」的用量来"）——校准的可感知性本身就是留存钩子
}

export type Verdict = "good" | "caution" | "avoid";

export interface ScoredPick {
  perfume: Perfume;
  score: number;
  breakdown: {
    season: number;
    daypart: number;
    occasion: number;
    weather: number;
    quality: number;
  };
  usage: Usage;
  risks: string[];
  reasons: string[]; // 规则生成的要点，DeepSeek 不可用时即为兜底解释
  verdict: Verdict; // 用香裁决：good 推荐 / caution 留意 / avoid 今天不建议
  /**
   * avoid 的成因（其余裁决为 null）。**归因必须在算的那一刻带出来**——
   * 这是 scoring.ts:WeatherTone 已经确立的纪律，此处是把它贯彻到裁决层。
   * 下游（发现型钩子的眉标）此前无从得知"为什么不建议"，只能写死「天气突变」，
   * 于是 20℃ 多云的一天也会弹出「天气突变」，正文却在说会议室或反季。
   */
  avoidCause: AvoidCause | null;
  /**
   * **触发这次 avoid 的那一条风险原文**（其余裁决为 null，取不到对应风险时也为 null）。
   * 与 avoidCause 同源取出，是同一条纪律的最后一段：预警卡的眉标按成因分岔，
   * 正文若还取 risks[0]，眉标写「季节不对」、正文却在讲高温——两句都为真，
   * 归因链却断了。下游一律用它，取不到才退按成因写死的兜底句。
   */
  avoidRisk: string | null;
}

/** 判「今天不建议」的四种成因，与 computeVerdict 的四条触发一一对应 */
export type AvoidCause = "weather" | "season" | "venue" | "fragrance_free";

export interface UserPerfume {
  perfumeId: number;
  addedAt: number;
  lastWornAt?: number;
  wornCount?: number; // 累计采纳次数（换香/吃灰采纳/反馈提交，同一天只计一次）——定义"常喷"的真实穿戴信号
  // 这里曾有一个 bias 字段：类型里声明、导入 schema 里校验，全仓零写零读。
  // 真正在用的是 recommend.ts:aggregateBias——每次从 feedbacks 现算，不落盘（口味会变，
  // 缓存一份偏置就要额外维护它的失效）。留着一个从没被赋值的同名字段，只会让下一个人
  // 以为偏置是存在瓶上的。删掉。
}

/** 由反馈聚合出的个人偏置（aggregateBias 的产物，score/computeUsage 的输入） */
export interface Bias {
  likeScore: number; // [-1,1] → 乘子 0.75..1.25
  perceivedStrength: number; // [-1,1]：>0 你觉得它冲 → 少喷；<0 觉得淡 → 多喷
  sceneMismatch?: Partial<Record<Occasion, number>>; // 「不合场合」次数（按场合），降权用
  successConfigs?: SuccessConfig[]; // 「刚好」时的成功配置——同温度档×同场合直接复用
}

/** 一次「刚好」反馈固化下来的成功配置 */
export interface SuccessConfig {
  occasion: Occasion;
  tempBand: "cold" | "cool" | "mild" | "hot";
  sprays: number; // 当时建议区间的中值
}

/** 香历条目：一天一条（后写覆盖，保留手记）。展示数据做快照——瓶子被移除后，香历依然完整 */
export interface WearEntry {
  d: string; // 本地日期键 "2026-07-08"
  perfumeId: number;
  name: string; // 展示名快照（中文名优先）
  fam: string; // 主香调 en（决定日历色点）
  occasion: Occasion;
  tempC: number | null; // 降级情境记 null——不知道就不记，香历不放编造的数
  weatherText: string;
  feel: Feel;
  note?: string; // 一句话手记（选填）
}

export interface Feedback {
  perfumeId: number;
  at: number;
  context: {
    season: Season;
    daypart: Daypart;
    tempC: number;
    occasion: Occasion;
    feel?: Feel; // 供环境归因（高温高湿天的"淡了"算天气的，不算香水的）
    humidity?: number;
  };
  rating: "too_weak" | "perfect" | "too_strong" | "scene_mismatch";
  sprays?: [number, number]; // 反馈时的建议喷量快照（成功配置复用的原料）
  tags?: string[]; // 如 ["env_attributed"]：该条"淡了"已归因环境，不进个人喷量校准
}
