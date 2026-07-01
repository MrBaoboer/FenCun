// 用香解释：DeepSeek 仅把"规则已算好的事实"翻译成有温度的人话。
// 决策权在规则引擎，这里只负责表达；严禁编造、严禁伪精确数字；失败降级为模板。
import { NextRequest, NextResponse } from "next/server";
import { allow, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";

const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

interface ExplainInput {
  name: string;
  brandZh: string;
  accords: string[]; // 中文香调（前几位）
  styleTags: string[];
  verdict?: "good" | "caution" | "avoid";
  scene?: { label: string; rawText?: string } | null;
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
5. 如果有风险提示，自然地融进话里提醒一句，但不说教。
6. 关于"裁决"字段，务必据此定调，不要一味迁就用户：
   · good：正常给出推荐与用法。
   · caution：可以用，但把要留意的点明确说清，别淡化。
   · avoid：这瓶今天其实不合适——**必须先明确说出"今天其实不太建议用这瓶"，并用给定的风险/天气/季节事实说清为什么**，绝不为讨好用户假装它合适；然后话锋一转，给一句"但你今天要是就想用它，可以这样把影响降到最低：…"，用我给的用法（减量/贴肤/挪喷洒位置）。诚实比迁就更重要。
7. 若给了"场景"字段（用户用自然语言描述的具体场合），要让解读**贴着这个场景**说话，呼应它的社交关系与分寸（如"初见投资人这种场合，稳一点更好"），别泛泛而谈。`;

function template(input: ExplainInput): string {
  const c = input.context;
  if (input.verdict === "avoid") {
    const why = input.risks[0] || "它和此刻的天气或场合不太合拍";
    return `说实话，今天不太建议用${input.name}——${why}。你要是今天就想用它，就${input.usage.spraysLabel}、只喷${input.usage.placement.join("、")}，把存在感压到最低。`;
  }
  const parts: string[] = [`今天${c.city}${c.weatherText}、${Math.round(c.tempC)}℃。`];
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
  // 无 key 或被限流 → 直接返回免费的规则模板（不打 DeepSeek），UX 不断、成本可控
  if (!KEY || !allow(`explain:${clientKey(req)}`, 15, 10_000)) {
    return NextResponse.json({ text: fallback, source: "template" });
  }

  const userMsg = `事实如下（JSON）：\n${JSON.stringify(
    {
      香水: `${input.brandZh} ${input.name}`,
      主香调: input.accords,
      风格: input.styleTags,
      裁决: input.verdict ?? "good",
      场景: input.scene ? `${input.scene.label}（用户原话：${input.scene.rawText ?? ""}）` : null,
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
        model: MODEL,
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
