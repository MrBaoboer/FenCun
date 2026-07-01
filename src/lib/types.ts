// 氛寸 · 核心类型契约

export interface Accord {
  en: string; // 英文键（供打分规则匹配）
  zh: string; // 中文（供展示）
  strength: number; // 0..100
}

export type Gender = "male" | "female" | "unisex";

export interface Perfume {
  id: number;
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
  // 个人偏置（由 Feedback 聚合；早期全 0）
  bias?: { likeScore: number; perceivedStrength: number };
}

export interface Feedback {
  perfumeId: number;
  at: number;
  context: { season: Season; daypart: Daypart; tempC: number; occasion: Occasion };
  rating: "too_weak" | "perfect" | "too_strong";
  tags?: string[];
}
