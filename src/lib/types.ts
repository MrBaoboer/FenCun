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
  lowVotes?: boolean; // 扩展集低票记录（国货白名单等）：社区统计仅供参考
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
  notePreference?: string[];
  tension?: "none" | "low" | "high"; // 关系张力（前任婚礼/谈判…）——存在时用户一定愿意说
  duration?: 2 | 4 | 6 | 9; // 在场时长档位（只允许档位值，禁止精确小时——伪精确红线）
  meal?: boolean; // 餐桌场合：压制浓香/甜香的关键开关（气味干扰味觉）
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
  notePreference?: string[];
  tension?: "none" | "low" | "high";
  duration?: 2 | 4 | 6 | 9;
  meal?: boolean;
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
}

export interface UserPerfume {
  perfumeId: number;
  addedAt: number;
  lastWornAt?: number;
  wornCount?: number; // 累计采纳次数（换香/吃灰采纳/反馈提交，同一天只计一次）——定义"常喷"的真实穿戴信号
  // 个人偏置（由 Feedback 聚合；早期全 0）
  bias?: { likeScore: number; perceivedStrength: number };
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
