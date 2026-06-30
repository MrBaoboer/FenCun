// 人话化表达 —— 全部区间/档位，绝不伪精确
import type { Season } from "./types";

// 社交距离：直接绑 sillage 四档，不按小数切
export const DISTANCE_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: "贴近才闻得到",
  2: "一臂之内",
  3: "一桌之间",
  4: "整间屋都是它",
};
export const DISTANCE_HINT: Record<1 | 2 | 3 | 4, string> = {
  1: "适合电梯、会议、就医等密闭场合",
  2: "正常社交距离可感，安全日常",
  3: "同桌或小房间能闻到，注意场合",
  4: "户外、夜场加分，密闭空间慎用",
};

// 留香：longevity 1..5 → 区间，绝不给小时数
export function durationHint(longevity: number | null): string {
  if (longevity == null) return "留香表现因人而异";
  if (longevity < 2) return "较快淡去，约半天，午后可补喷";
  if (longevity < 3) return "大半个白天，傍晚有场合可补";
  if (longevity < 4) return "基本撑一整个白天";
  return "可能延续到夜晚，少喷即可";
}

export const SEASON_NAME: Record<Season, string> = {
  winter: "冬季",
  spring: "春季",
  summer: "夏季",
  autumn: "秋季",
};

export const OCCASION_LABEL: Record<string, string> = {
  commute: "通勤",
  work: "上班",
  date: "约会",
  social: "聚会",
  formal: "正式场合",
  casual: "休闲",
  home: "居家",
  sport: "运动",
};

export function genderLabel(g: string): string {
  return g === "male" ? "偏男香" : g === "female" ? "偏女香" : "中性";
}

// 留香短标签（用于统计行）
export function durationShort(longevity: number | null): string {
  if (longevity == null) return "因人而异";
  if (longevity < 2) return "约半天";
  if (longevity < 3) return "大半个白天";
  if (longevity < 4) return "一整个白天";
  return "可能到夜晚";
}

export const SILLAGE_WORD: Record<1 | 2 | 3 | 4, string> = {
  1: "贴肤",
  2: "近身",
  3: "半室",
  4: "外放",
};

// 名称展示：中文名为主、英文为辅；无中文名则英文作主、不带副名
export function nameParts(p: { name: string; nameZh: string | null }): {
  primary: string;
  secondary: string | null;
  primaryIsZh: boolean;
} {
  if (p.nameZh && p.nameZh.trim()) {
    return { primary: p.nameZh, secondary: p.name, primaryIsZh: true };
  }
  return { primary: p.name, secondary: null, primaryIsZh: false };
}
