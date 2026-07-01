// 结合天气与时段的简短问候文案（放在天气卡左侧）
import type { Context } from "./types";

export function weatherGreeting(ctx: Context): string {
  const t = ctx.weatherText || "";
  const night = ctx.daypart === "night";

  if (/雷/.test(t)) return "雷动，稳住心神";
  if (/暴雨|大雨/.test(t)) return "雨大，护好衣角";
  if (/雨/.test(t)) return night ? "夜雨微凉" : "记得带把伞";
  if (/雪/.test(t)) return "落雪，慢些走";
  if (/雾|霾/.test(t)) return night ? "雾夜，走近才闻" : "雾里，慢些走";
  if (/沙|尘/.test(t)) return "风沙，护住口鼻";

  if (ctx.feel === "hot_humid") return night ? "夜里仍闷" : "有点闷，宜清爽";
  if (ctx.feel === "hot_dry") return night ? "暑气未散" : "日头正盛";
  if (ctx.feel === "cold") return night ? "入夜生寒" : "天凉，添件外套";

  if (/晴/.test(t)) return night ? "夜色清朗" : "好晴天，宜出门";
  if (/云|阴/.test(t)) return night ? "云影入夜" : "云淡风轻";
  if (/风/.test(t)) return night ? "夜风渐起" : "风起，衣袂轻扬";

  return night ? "夜色正好" : "今天，刚刚好";
}
