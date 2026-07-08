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
  // 回南天/梅雨（20~27℃ 但湿度极高）：气味在湿空气里散不掉、甜香白花被放大，
  // 按闷湿处理——对中国市场，这比"28℃ 以下一律温和"更接近体感真相
  if (tempC >= 20 && humidity >= 85) return "hot_humid";
  if (tempC <= 10) return "cold";
  return "mild";
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

export const SEASON_ZH: Record<Season, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

export const FEEL_ZH: Record<Feel, string> = {
  hot_humid: "闷热潮湿",
  hot_dry: "干热",
  mild: "温和",
  cold: "寒凉",
};
