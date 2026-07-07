// 结合天气与时段的简短问候文案（放在天气卡左侧）
import type { Context } from "./types";

export function weatherGreeting(ctx: Context): string {
  const t = ctx.weatherText || "";
  const night = ctx.daypart === "night";

  // 问候一律控制在 4 字（兜底句 6 字）——天气卡问候是单行 truncate，过长会被省略号截断，
  // 故极长问候回退到 4 字文艺前缀（细雨绵绵/凉意渐起…），既永不截断、又保住文艺。
  if (/雷/.test(t)) return "雷声阵阵";
  if (/暴雨|大雨/.test(t)) return "大雨滂沱";
  if (/雨/.test(t)) return night ? "夜雨微凉" : "细雨绵绵";
  if (/雪/.test(t)) return night ? "夜雪静落" : "雪落无声";
  if (/雾|霾/.test(t)) return night ? "雾锁长夜" : "雾色朦胧";
  if (/沙|尘/.test(t)) return "风沙扑面";

  if (ctx.feel === "hot_humid") return night ? "夜里潮闷" : "暑气黏人";
  if (ctx.feel === "hot_dry") return night ? "暑气未散" : "日头正盛";
  if (ctx.feel === "cold") return night ? "入夜生寒" : "凉意渐起";

  if (/晴/.test(t)) return night ? "夜色清朗" : "晴光正好";
  if (/云|阴/.test(t)) return night ? "云影入夜" : "云淡风轻";
  if (/风/.test(t)) return night ? "夜风渐起" : "衣袂轻扬";

  return night ? "夜色正好" : "今天，刚刚好";
}
