// 自然语言场景 → 结构化情境补丁（DeepSeek 解析，zod 校验，失败降级关键词启发式）
// 这是氛寸的差异化：真正理解"去前任婚礼""第一次见投资人"的语义，而非硬套标签
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";

const PatchSchema = z.object({
  occasion: z.enum(["commute", "work", "date", "social", "formal", "casual", "home", "sport"]),
  formality: z.number().min(0).max(1).optional(),
  intimacy: z.enum(["close", "neutral", "broadcast"]).optional(),
  avoid: z.array(z.enum(["too_sweet", "too_strong", "too_formal", "cloying", "too_casual"])).optional(),
  label: z.string().min(1).max(24),
});

const SYSTEM = `你是"氛寸"的场景理解引擎。用户会用一句话描述今天的用香场合，你要真正理解其中的社交关系、情绪张力、正式度、亲密距离与表达意图，而不是生硬套标签，然后输出一个 JSON 补丁。

只输出 JSON（无多余文字），字段：
- occasion：从 [commute, work, date, social, formal, casual, home, sport] 里选最贴合的一个。
- formality：0~1，越正式越高。
- intimacy：close(近距离贴身，如约会看展)/neutral(常规社交距离)/broadcast(想被更多人注意到)。
- avoid：数组，可含 too_sweet(别太甜)/too_strong(别太冲/扩散别太大)/too_formal(别太端着)/cloying(别腻)/too_casual(别太随意)。按场景语义判断该规避什么。
- label：≤12字的中文人话摘要，点出场景气质（例："前任婚礼·得体克制""初见投资人·稳重不抢戏""看展约会·近距离"）。

示例思路：
- "去前任婚礼" → formal 偏正式、intimacy neutral、avoid [too_strong, too_sweet]（得体、不张扬、不喧宾夺主）、label "前任婚礼·得体克制"。
- "第一次见投资人" → work/formal、formality 0.8、avoid [too_strong, too_sweet]、label "初见投资人·稳重不抢戏"。
- "和暧昧对象看展" → date、intimacy close、formality 0.3、label "看展约会·宜近距离"。
- "朋友生日局但不想太张扬" → social、avoid [too_strong]、intimacy neutral、label "生日局·低调不抢镜"。`;

function heuristic(text: string) {
  const t = text.toLowerCase();
  const has = (...ks: string[]) => ks.some((k) => t.includes(k));
  let occasion = "casual", formality = 0.4, intimacy: "close" | "neutral" | "broadcast" = "neutral";
  const avoid: string[] = [];
  let label = text.length <= 12 ? text : text.slice(0, 11) + "…";
  if (has("婚礼", "婚宴", "喜宴")) { occasion = "formal"; formality = 0.75; avoid.push("too_strong", "too_sweet"); label = "婚礼场合·得体克制"; }
  else if (has("投资人", "面试", "客户", "领导", "见家长", "正式", "商务", "会议")) { occasion = "formal"; formality = 0.8; avoid.push("too_strong"); label = "正式场合·稳重不抢戏"; }
  else if (has("约会", "暧昧", "看展", "看电影", "对象", "心动")) { occasion = "date"; formality = 0.3; intimacy = "close"; label = "约会·宜近距离"; }
  else if (has("聚会", "派对", "生日", "朋友", "局", "夜店", "酒吧")) { occasion = "social"; label = "聚会·自在"; }
  else if (has("运动", "健身", "跑步", "球")) { occasion = "sport"; formality = 0.1; label = "运动·清爽"; }
  else if (has("居家", "在家", "睡前", "休息")) { occasion = "home"; formality = 0.1; label = "居家·放松"; }
  else if (has("通勤", "上班", "地铁", "工作")) { occasion = "commute"; formality = 0.5; label = "通勤·清爽得体"; }
  return { occasion, formality, intimacy, avoid, label };
}

export async function POST(req: NextRequest) {
  let text = "";
  try {
    text = (((await req.json()) as { text?: string })?.text ?? "").trim();
  } catch {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });

  const fallback = { ...heuristic(text), source: "heuristic" as const };
  if (!KEY) return NextResponse.json(fallback);

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: text },
        ],
        temperature: 0.4,
        max_tokens: 200,
        response_format: { type: "json_object" },
        stream: false,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return NextResponse.json(fallback);
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    const parsed = PatchSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return NextResponse.json(fallback);
    return NextResponse.json({ ...parsed.data, source: "deepseek" });
  } catch {
    return NextResponse.json(fallback);
  }
}
