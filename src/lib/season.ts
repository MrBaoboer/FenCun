// 季节 / 体感 / 时段推断 —— 不只看月份，气温同样参与判断
import type { Season, Feel, Daypart } from "./types";

export function seasonFromDateTemp(date: Date, tempC: number | null): Season {
  const m = date.getMonth() + 1; // 1..12（北半球默认）
  let base: Season;
  if (m === 12 || m <= 2) base = "winter";
  else if (m <= 5) base = "spring";
  else if (m <= 8) base = "summer";
  else base = "autumn";
  // 气温修正：极端温度盖过月份直觉
  if (tempC != null) {
    if (tempC >= 28) return "summer";
    if (tempC <= 6) return "winter";
  }
  return base;
}

export function feelFromWeather(tempC: number, humidity: number): Feel {
  if (tempC >= 28) return humidity >= 65 ? "hot_humid" : "hot_dry";
  if (tempC <= 10) return "cold";
  return "mild";
}

// ⚠️ 已删除的规则：`tempC >= 20 && humidity >= 85 → hot_humid`（原"回南天/梅雨"规则）
//
// 它当初的理由是「气味在湿空气里散不掉、甜香白花被放大」。循证复核的结论是：
// **这个机制在物理上是错的**——"水分子把香气分子裹住悬在空中"不成立；而受控气候舱研究显示，
// 20–35℃ / 30–75%RH 区间内温湿度对健康人的嗅觉阈值、辨别与识别均无显著影响。
// 更直接的问题是分档本身：22℃/90% 与 30℃/70% 被判成同一个体感，可它们干球温差 8℃，
// 不是同一件事。删除它不需要任何复杂论证，8℃ 就够了。
//
// 回南天真正的感知问题也不是"热"，是**衣物与柜子里的霉潮本底气味**——
// 这是华南用户真实会遇到、且与香水直接相关的一件事，但它属于文案层，不该进打分。
/** 回南天/梅雨的霉潮本底：只驱动文案提示，不参与任何打分或喷量计算 */
export function mustyAir(tempC: number, humidity: number): boolean {
  return tempC >= 15 && tempC <= 25 && humidity >= 90;
}

// 温度档（供成功配置复用与反馈归因：同温度档 × 同场合 → 直接用上次「刚好」的量）
export function tempBand(tempC: number): "cold" | "cool" | "mild" | "hot" {
  if (tempC <= 10) return "cold";
  if (tempC <= 19) return "cool";
  if (tempC <= 27) return "mild";
  return "hot";
}

export function daypartFromHour(hour: number): Daypart {
  return hour >= 6 && hour < 18 ? "day" : "night";
}

export const FEEL_ZH: Record<Feel, string> = {
  hot_humid: "闷热潮湿",
  hot_dry: "干热",
  mild: "温和",
  cold: "寒凉",
};
