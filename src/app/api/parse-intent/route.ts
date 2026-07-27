// 自然语言场景 → 结构化情境补丁（DeepSeek 解析，zod 校验，失败降级关键词启发式）
// 这是氛寸的差异化：真正理解"去前任婚礼""第一次见投资人"的语义，而非硬套标签
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { allow, clientKey, withinDailyBudget } from "@/lib/ratelimit";

export const runtime = "nodejs";

const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

const PatchSchema = z.object({
  occasion: z.enum(["commute", "work", "date", "social", "formal", "casual", "home", "sport"]),
  formality: z.number().min(0).max(1).optional(),
  intimacy: z.enum(["close", "neutral", "broadcast"]).optional(),
  avoid: z.array(z.enum(["too_sweet", "too_strong", "too_formal", "cloying", "too_casual"])).optional(),
  // 关系张力（前任/谈判/竞对同席）——平时不存在，存在时用户一定会说，权重极高
  tension: z.enum(["none", "low", "high"]).optional(),
  // 在场时长只许档位值：LLM 能输出任意数字，就会输出"7.5"这种没有信息量的伪精确
  duration: z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(9)]).optional(),
  meal: z.boolean().optional(), // 餐桌场合：压制浓香的关键开关（气味干扰味觉）
  fragranceFree: z.boolean().optional(), // 就医/探病等无香场合：命中即建议今天不用香
  riskNote: z.string().max(40).optional(), // 一句话社交风险，以受控字段进入风险提示，不许自由发挥进正文
  label: z.string().min(1).max(24),
});

const SYSTEM = `你是"氛寸"的场景理解引擎。用户会用一句话描述今天的用香场合，你要真正理解其中的社交关系、情绪张力、正式度、亲密距离与表达意图，而不是生硬套标签，然后输出一个 JSON 补丁。

只输出 JSON（无多余文字），字段：
- occasion：从 [commute, work, date, social, formal, casual, home, sport] 里选最贴合的一个。
- formality：0~1，越正式越高。
- intimacy：close(近距离贴身，如约会看展)/neutral(常规社交距离)/broadcast(想被更多人注意到)。
- avoid：数组，可含 too_sweet(别太甜)/too_strong(别太冲/扩散别太大)/too_formal(别太端着)/cloying(别腻)/too_casual(别太随意)。按场景语义判断该规避什么。
- tension：none/low/high，关系张力——前任、谈判对手、竞争者同席、想赢的场合是 high；普通紧张是 low；没有就 none 或省略。
- duration：2/4/6/9 之一（预计在场小时的档位，选最接近的：快事≈2、饭局婚礼看展≈4、长活动≈6、上班全天≈9），judge 不出就省略。
- meal：true/false，这个场合是否围着饭桌（婚宴/日料/火锅/酒局都算）——气味会干扰味觉。
- fragranceFree：true/false，这是不是**无香场合**。就医、看病、陪诊、探病、体检、化疗/病房、月子中心、备孕产检都算 true。这类场合里有人对气味格外敏感且无法回避，命中时氛寸会建议今天不用香。拿不准就省略（默认 false），但只要出现医院相关线索就大胆给 true。
- riskNote：≤20 字的一句话社交风险（如"婚礼焦点是新人，不宜喧宾夺主"），没有就省略。
- label：≤12字的中文人话摘要，点出场景气质（例："前任婚礼·得体克制""初见投资人·稳重不抢戏""看展约会·近距离"）。

示例思路：
- "去前任婚礼" → formal、formality 0.75、intimacy neutral、avoid [too_strong, too_sweet]、tension high、duration 4、meal true、riskNote "婚礼焦点是新人，不宜喧宾夺主"、label "前任婚礼·得体克制"。
- "第一次见投资人" → work/formal、formality 0.8、avoid [too_strong, too_sweet]、tension low、duration 2、meal false、riskNote "会议室密闭，浓香会被放大"、label "初见投资人·稳重不抢戏"。
- "晚上和喜欢的人第一次约会，吃日料" → date、intimacy close、formality 0.4、tension low、duration 4、meal true、riskNote "日料店重食物香气，浓香失礼"、label "日料初见·近距离克制"。
- "朋友生日局但不想太张扬" → social、avoid [too_strong]、intimacy neutral、meal true、label "生日局·低调不抢镜"。
- "下午去医院看我妈" → formal/casual、fragranceFree true、riskNote "病房里有人对气味敏感且无法回避"、label "探病·今天不用香"。`;

// 导出是为了可测：这条启发式承载「无香场合」红线（见下方 fragranceFree），
// 而它恰恰是**没有 API key 时唯一会走到的那条路**——贡献者本地跑、线上限流或超时后，
// 用户看到的都是它的输出。纯函数、零副作用，导出不改变任何运行时行为。
export function heuristic(text: string) {
  const t = text.toLowerCase();
  const has = (...ks: string[]) => ks.some((k) => t.includes(k));
  let occasion = "casual", formality = 0.4, intimacy: "close" | "neutral" | "broadcast" = "neutral";
  const avoid: string[] = [];
  let meal: boolean | undefined;
  let label = text.length <= 12 ? text : text.slice(0, 11) + "…";
  if (has("婚礼", "婚宴", "喜宴")) { occasion = "formal"; formality = 0.75; avoid.push("too_strong", "too_sweet"); meal = true; label = "婚礼场合·得体克制"; }
  else if (has("投资人", "面试", "客户", "领导", "见家长", "正式", "商务", "会议")) { occasion = "formal"; formality = 0.8; avoid.push("too_strong"); label = "正式场合·稳重不抢戏"; }
  else if (has("约会", "暧昧", "看展", "看电影", "对象", "心动")) { occasion = "date"; formality = 0.3; intimacy = "close"; label = "约会·宜近距离"; }
  else if (has("聚会", "派对", "生日", "朋友", "局", "夜店", "酒吧")) { occasion = "social"; label = "聚会·自在"; }
  else if (has("运动", "健身", "跑步", "球")) { occasion = "sport"; formality = 0.1; label = "运动·清爽"; }
  else if (has("居家", "在家", "睡前", "休息")) { occasion = "home"; formality = 0.1; label = "居家·放松"; }
  else if (has("通勤", "上班", "地铁", "工作")) { occasion = "commute"; formality = 0.5; label = "通勤·清爽得体"; }
  // 横切信号（与场合正交）：关系张力、饭桌、无香场合
  const tension = has("前任", "前女友", "前男友", "谈判", "对手") ? ("high" as const) : undefined;
  if (meal === undefined && has("吃", "饭", "餐厅", "火锅", "日料", "酒局", "宴")) meal = true;
  // 无香场合必须在启发式里也兜住：这条规则的价值恰恰在 LLM 不可用时也不能失效
  const fragranceFree = has("医院", "看病", "就医", "门诊", "诊所", "探病", "住院", "病房", "体检", "陪诊", "化疗", "产检", "月子");
  if (fragranceFree) {
    occasion = "casual";
    label = "就医探病·今天不用香";
  }
  return { occasion, formality, intimacy, avoid, tension, meal, fragranceFree, label };
}

export async function POST(req: NextRequest) {
  let text = "";
  try {
    text = (((await req.json()) as { text?: string })?.text ?? "").trim();
  } catch {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (text.length > 120) text = text.slice(0, 120); // 输入上限：防超长/成本/注入面

  const fallback = { ...heuristic(text), source: "heuristic" as const };
  // 无 key 或被限流 → 关键词启发式（不打 DeepSeek），仍能给出可用结构
  if (!KEY || !allow(`parse:${clientKey(req)}`, 8, 10_000) || !withinDailyBudget()) {
    return NextResponse.json(fallback);
  }

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
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
    // 容错：模型偶发在 json_object 外带 ```json 围栏或解释文字 → 截取首个 { 到末个 } 再解析，
    // 避免白白丢掉一次本可用的 LLM 结果、降到粗粒度启发式
    if (typeof raw !== "string") return NextResponse.json(fallback);
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s < 0 || e <= s) return NextResponse.json(fallback);
    const parsed = PatchSchema.safeParse(JSON.parse(raw.slice(s, e + 1)));
    if (!parsed.success) return NextResponse.json(fallback);
    // label 与提示口径对齐（≤12 字），与启发式兜底一致，防超长撑版
    return NextResponse.json({ ...parsed.data, label: parsed.data.label.slice(0, 12), source: "deepseek" });
  } catch {
    return NextResponse.json(fallback);
  }
}
