// 用香解释：DeepSeek 仅把"规则已算好的事实"翻译成有温度的人话。
// 决策权在规则引擎，这里只负责表达；严禁编造、严禁伪精确数字；失败降级为模板。
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";

interface ExplainInput {
  name: string;
  brandZh: string;
  accords: string[]; // 中文香调（前几位）
  styleTags: string[];
  context: {
    city: string;
    tempC: number;
    humidity: number;
    weatherText: string;
    feel: string;
    season: string;
    daypart: string;
    occasion: string;
  };
  usage: {
    spraysLabel: string;
    placement: string[];
    distance: string;
    durationHint: string;
  };
  reasons: string[];
  risks: string[];
}

const SYSTEM = `你是"氛寸"——一个懂香水、懂场景、有分寸感的用香顾问。你的任务：把下面这些"已经由规则引擎算好的客观事实"，组织成一段自然、有温度、像懂行朋友会说的中文话。

铁律：
1. 只能使用我给你的事实，绝不编造任何香调、数据、场景或天气。
2. 绝不输出精确到小时/毫升的伪精确数字（如"留香6.2小时""喷3.7ml"）。留香、喷量、距离一律沿用我给的区间/档位措辞。
3. 语气克制、温暖、不谄媚、不堆砌形容词。2~4 句话，像对朋友说话。
4. 直接输出这段话本身，不要任何前缀、标题、引号、要点符号或解释你在做什么。
5. 如果有风险提示，自然地融进话里提醒一句，但不说教。`;

function template(input: ExplainInput): string {
  const parts: string[] = [];
  parts.push(`今天${input.context.city}${input.context.weatherText}、${input.context.tempC}℃。`);
  if (input.reasons.length) parts.push(input.reasons[0] + "。");
  parts.push(`建议喷 ${input.usage.spraysLabel}，喷在${input.usage.placement.join("、")}，留香${input.usage.durationHint}。`);
  if (input.risks.length) parts.push(input.risks[0]);
  return parts.join("");
}

export async function POST(req: NextRequest) {
  let input: ExplainInput;
  try {
    input = (await req.json()) as ExplainInput;
  } catch {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }

  const fallback = template(input);
  if (!KEY) return NextResponse.json({ text: fallback, source: "template" });

  const userMsg = `事实如下（JSON）：\n${JSON.stringify(
    {
      香水: `${input.brandZh} ${input.name}`,
      主香调: input.accords,
      风格: input.styleTags,
      此刻: input.context,
      用法: input.usage,
      为什么合适: input.reasons,
      风险提示: input.risks,
    },
    null,
    2
  )}`;

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
        temperature: 0.7,
        max_tokens: 320,
        stream: false,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return NextResponse.json({ text: fallback, source: "template" });
    const data = await res.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return NextResponse.json({ text: fallback, source: "template" });
    return NextResponse.json({ text, source: "deepseek" });
  } catch {
    return NextResponse.json({ text: fallback, source: "template" });
  }
}
