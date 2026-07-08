// 用香解释：DeepSeek 仅把"规则已算好的事实"翻译成有温度的人话。
// 决策权在规则引擎，这里只负责表达；严禁编造、严禁伪精确数字；失败降级为模板。
// 两道代码级防线：① avoid 裁决不许被说软（否定语义正则）；② 数字白名单——
// LLM 输出里出现任何"我们没给过它"的数字（如编造的"留香6.2小时"）→ 整段丢弃，退模板。
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { allow, clientKey } from "@/lib/ratelimit";
import { extractDigits, findInventedNumbers } from "@/lib/numguard";

export const runtime = "nodejs";

const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

// 入参校验：字段限长、数组限条、枚举白名单——这是三条路由里入参结构最复杂的一条，
// 没有校验就是"半自由 LLM 代理 + 无上限输入 token 账单"
const ExplainSchema = z.object({
  name: z.string().min(1).max(80),
  brandZh: z.string().max(60),
  accords: z.array(z.string().max(24)).max(8),
  styleTags: z.array(z.string().max(24)).max(8),
  verdict: z.enum(["good", "caution", "avoid"]).optional(),
  scene: z
    .object({ label: z.string().max(24), rawText: z.string().max(120).optional() })
    .nullable()
    .optional(),
  context: z.object({
    city: z.string().max(40),
    tempC: z.number().min(-60).max(60),
    humidity: z.number().min(0).max(100),
    weatherText: z.string().max(40),
    feel: z.string().max(20),
    season: z.string().max(20),
    daypart: z.string().max(20),
    occasion: z.string().max(20),
  }),
  usage: z.object({
    spraysLabel: z.string().max(20),
    placement: z.array(z.string().max(30)).max(6),
    distance: z.string().max(30),
    durationHint: z.string().max(100),
  }),
  reasons: z.array(z.string().max(140)).max(8),
  risks: z.array(z.string().max(180)).max(8),
});
type ExplainInput = z.infer<typeof ExplainSchema>;

const SYSTEM = `你是"氛寸"——一个懂香水、懂场景、有分寸感的用香顾问。你的任务：把下面这些"已经由规则引擎算好的客观事实"，组织成一段自然、有温度、像懂行朋友会说的中文话。

铁律：
1. 只能使用我给你的事实，绝不编造任何香调、数据、场景或天气。
2. 绝不输出精确到小时/毫升的伪精确数字（如"留香6.2小时""喷3.7ml"）。留香、喷量、距离一律沿用我给的区间/档位措辞。不许出现任何我没给过的数字。
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
    const parsed = ExplainSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "bad_input" }, { status: 400 });
    input = parsed.data;
  } catch {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }

  const fallback = template(input);
  // 无 key 或被限流 → 直接返回免费的规则模板（不打 DeepSeek），UX 不断、成本可控。
  // 限流 8 次/10 秒：客户端有 550ms 防抖 + 结果缓存，正常人远用不到；剩下的是脚本。
  if (!KEY || !allow(`explain:${clientKey(req)}`, 8, 10_000)) {
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
  // 白名单以"实际递给模型的字符串"为准——凡我们说过的数字都合法，其余都算编造
  const allowedNumbers = extractDigits(userMsg);

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
    // 防线①（铁律 6 的代码级）：avoid 裁决的返回若不含否定语义（LLM 软化/漏说"不建议"），
    // 回退确定性模板（它天然以"说实话，今天不太建议"开头），不让 LLM 把该劝退的场景圆成可用。
    if (input.verdict === "avoid" && !/不建议|不太建议|不太合适|不合适|不宜|慎|其实不/.test(text)) {
      return NextResponse.json({ text: fallback, source: "template" });
    }
    // 防线②（铁律 2 的代码级）：数字白名单。"反伪精确"不能只是提示词里的一句拜托。
    const invented = findInventedNumbers(text, allowedNumbers);
    if (invented.length > 0) {
      console.warn(`[explain] LLM 编造数字被拦截: ${invented.join(",")}`);
      return NextResponse.json({ text: fallback, source: "template" });
    }
    return NextResponse.json({ text, source: "deepseek" });
  } catch {
    return NextResponse.json({ text: fallback, source: "template" });
  }
}
