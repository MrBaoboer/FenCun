// 自然语言场景 → 结构化情境补丁（DeepSeek 解析，zod 校验，失败降级关键词启发式）
// 这是氛寸的差异化：真正理解"去前任婚礼""第一次见投资人"的语义，而非硬套标签
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { allow, clientKey, withinDailyBudget, fromOwnPage } from "@/lib/ratelimit";
import { classifyFetchError, describeChoice, logDegrade, readUpstreamError } from "@/lib/llmlog";
import { carriesNumber } from "@/lib/numguard";

export const runtime = "nodejs";

const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

// 导出是为了可测：riskNote 的「带数字整条丢掉」是反伪精确的源头闸门，
// 它必须有东西守着——纯 schema、零副作用，导出不改变任何运行时行为。
export const PatchSchema = z.object({
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
  // 一句话社交风险，以受控字段进入风险提示，不许自由发挥进正文。
  // **带数字的一律丢掉**：这一句是用户原话经 LLM 转写来的，是全链路里唯一一段
  // 混在"规则算出来的事实"中间、却源自用户自由输入的文本。它会被 computeRiskNotes
  // 逐字下推进 risks[]，再被 /api/explain 收进数字白名单——用户写一句「会议约 6.2 小时」，
  // 反伪精确这道防线就被他自己的输入从内部打开了（见 numguard.ts:carriesNumber）。
  // 社交风险本来就不需要数字，丢掉整条比试图清洗它更干净。
  riskNote: z
    .string()
    .max(40)
    .optional()
    .transform((s) => (s && carriesNumber(s) ? undefined : s)),
  label: z.string().min(1).max(24),
});

const SYSTEM = `你是「氛寸」的场景理解引擎。用户会用一句话描述今天的用香场合。读懂其中的社交关系、情绪张力、正式度、亲密距离与表达意图，而不是生硬套标签，然后输出一个 JSON 补丁。

只输出 JSON（无多余文字），字段：
- occasion：从 [commute, work, date, social, formal, casual, home, sport] 里选最贴合的一个。
- formality：0~1，越正式越高。
- intimacy：close(近距离贴身，如约会看展)/neutral(常规社交距离)/broadcast(想被更多人注意到)。
- avoid：数组，可含 too_sweet(别太甜)/too_strong(别太冲/扩散别太大)/too_formal(别太端着)/cloying(别腻)/too_casual(别太随意)。按场景语义判断该规避什么。
- tension：none/low/high，关系张力——前任、谈判对手、竞争者同席、想赢的场合是 high；普通紧张是 low；没有就 none 或省略。
- duration：2/4/6/9 之一（预计在场小时的档位，选最接近的：快事≈2、饭局婚礼看展≈4、长活动≈6、上班全天≈9），判断不出就省略。
- meal：true/false，这个场合是否围着饭桌（婚宴/日料/火锅/酒局都算）——气味会干扰味觉。
- fragranceFree：true/false，这是不是**无香场合**。就医、看病、陪诊、探病、体检、化疗/病房、月子中心、备孕产检都算 true——这类场合里有人对气味格外敏感又躲不开。拿不准就省略，但只要出现医院相关线索就大胆给 true。
- riskNote：≤20 字的一句话社交风险（如「婚礼焦点是新人，不宜喧宾夺主」），没有就省略。
- label：≤12 字的中文摘要，点出场景气质（例：「前任婚礼·得体克制」「初见投资人·稳重不抢戏」「看展约会·近距离」）。

示例思路：
- 「去前任婚礼」→ formal、formality 0.75、intimacy neutral、avoid [too_strong, too_sweet]、tension high、duration 4、meal true、riskNote「婚礼焦点是新人，不宜喧宾夺主」、label「前任婚礼·得体克制」。
- 「第一次见投资人」→ work/formal、formality 0.8、avoid [too_strong, too_sweet]、tension low、duration 2、meal false、riskNote「会议室密闭，浓香会被放大」、label「初见投资人·稳重不抢戏」。
- 「晚上和喜欢的人第一次约会，吃日料」→ date、intimacy close、formality 0.4、tension low、duration 4、meal true、riskNote「日料店重食物香气，浓香失礼」、label「日料初见·近距离克制」。
- 「朋友生日局但不想太张扬」→ social、avoid [too_strong]、intimacy neutral、meal true、label「生日局·低调不抢镜」。
- 「下午去医院看我妈」→ formal/casual、fragranceFree true、riskNote「病房里有人对气味敏感且无法回避」、label「探病·今天不用香」。`;

// 导出是为了可测：这条启发式承载「无香场合」红线（见下方 fragranceFree），
// 而它恰恰是**没有 API key 时唯一会走到的那条路**——贡献者本地跑、线上限流或超时后，
// 用户看到的都是它的输出。纯函数、零副作用，导出不改变任何运行时行为。
export function heuristic(text: string) {
  const t = text.toLowerCase();
  const has = (...ks: string[]) => ks.some((k) => t.includes(k));
  let occasion = "casual", formality = 0.4, intimacy: "close" | "neutral" | "broadcast" = "neutral";
  const avoid: string[] = [];
  let meal: boolean | undefined;
  // 在场时长档位。此前这条路一个都不给，于是「在外时间不短，带上分装中途补 1 下更稳」
  // 这条已上线的能力在无 key / 限流 / 上游超时时整条消失——而降级路径恰恰是最需要它的时候。
  // 档位取值与 SYSTEM 提示词里给 LLM 的那四档同源：快事≈2、饭局婚礼看展≈4、长活动≈6、上班全天≈9。
  let duration: 2 | 4 | 6 | 9 | undefined;
  let label = text.length <= 12 ? text : text.slice(0, 11) + "…";
  // 有没有真的读懂：任何一条规则命中才算。全都没中时不许拿原话回显冒充理解（见下方 matched）
  let hit = true;
  if (has("婚礼", "婚宴", "喜宴")) { occasion = "formal"; formality = 0.75; avoid.push("too_strong", "too_sweet"); meal = true; duration = 4; label = "婚礼·得体克制"; }
  else if (has("投资人", "面试", "客户", "领导", "见家长", "正式", "商务", "会议")) { occasion = "formal"; formality = 0.8; avoid.push("too_strong"); duration = 2; label = "正式场合·稳重不抢戏"; }
  else if (has("约会", "暧昧", "看展", "看电影", "对象", "心动")) { occasion = "date"; formality = 0.3; intimacy = "close"; duration = 4; label = "约会·近距离"; }
  else if (has("聚会", "派对", "生日", "朋友", "局", "夜店", "酒吧")) { occasion = "social"; duration = 4; label = "聚会·自在"; }
  else if (has("运动", "健身", "跑步", "球")) { occasion = "sport"; formality = 0.1; duration = 2; label = "运动·清爽"; }
  else if (has("居家", "在家", "睡前", "休息")) { occasion = "home"; formality = 0.1; label = "居家·放松"; }
  else if (has("通勤", "上班", "地铁", "工作")) { occasion = "commute"; formality = 0.5; duration = 9; label = "通勤·清爽得体"; }
  else hit = false;
  // 横切信号（与场合正交）：关系张力、饭桌、无香场合
  const tension = has("前任", "前女友", "前男友", "谈判", "对手") ? ("high" as const) : undefined;
  if (meal === undefined && has("吃", "饭", "餐厅", "火锅", "日料", "酒局", "宴")) meal = true;
  // 无香场合必须在启发式里也兜住：这条规则的价值恰恰在 LLM 不可用时也不能失效
  const fragranceFree = has("医院", "看病", "就医", "门诊", "诊所", "探病", "住院", "病房", "体检", "陪诊", "化疗", "产检", "月子");
  if (fragranceFree) {
    occasion = "casual";
    label = "就医探病·今天不用香";
  }
  // 横切信号也算读懂了一部分
  const matched = hit || fragranceFree || tension != null || meal === true;
  return { occasion, formality, intimacy, avoid, tension, meal, duration, fragranceFree, label, matched };
}

/**
 * 无香场合这条红线取**并集**：关键词判定说 true 就一定是 true，LLM 只能加不能减。
 *
 * 此前 LLM 一旦成功返回，上面那十三个关键词的判定就被整条丢弃——而这是全引擎
 * 依据最好、后果最重的一条规则（就医 / 探病 → 今天不用香），它的可靠性不该
 * 取决于模型这一次有没有想起来给 fragranceFree。启发式那条路专门为它写了守卫，
 * 却只在 LLM 不可用时才跑，也就是说**平时它一次都不生效**。
 *
 * 方向本来就是不对称的：用户句子里出现「病房」而模型漏判，代价是推荐一个人
 * 喷着香水进病房；反过来模型多判一次，代价只是今天少喷一瓶香。
 * 不对称的代价，就不该用对称的规则去处理。
 *
 * 纯函数、零副作用，导出是为了可测。
 */
export function unionFragranceFree(
  llm: { fragranceFree?: boolean; label: string },
  heuristic: { fragranceFree: boolean; label: string }
): { fragranceFree: boolean; label: string } {
  const fragranceFree = Boolean(llm.fragranceFree) || heuristic.fragranceFree;
  // 模型漏判时它的 label 多半也没提这件事，跟着兜底那句走——
  // 否则会出现眉标写「探病·从容」、结论写「今天不用香」的错位。
  const label = fragranceFree && !llm.fragranceFree ? heuristic.label : llm.label;
  return { fragranceFree, label };
}

export async function POST(req: NextRequest) {
  // 来源校验排在最前（见 ratelimit.ts:fromOwnPage）：跨源请求不该被服务，
  // 也不该像限流那样退回启发式——那是给我们自己的用户的兜底。
  if (!fromOwnPage(req)) return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  // 与 explain 同理：限流挡的是「打不打 DeepSeek」，挡不住「读不读这个 body」。
  // 这条路由只收一个 ≤120 字的 text，1KB 之外一律不读。
  const len = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(len) && len > 1024) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  let text = "";
  try {
    text = (((await req.json()) as { text?: string })?.text ?? "").trim();
  } catch {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (text.length > 120) text = text.slice(0, 120); // 输入上限：防超长/成本/注入面

  const fallback = { ...heuristic(text), source: "heuristic" as const };
  // 无 key 或被限流 → 关键词启发式（不打 DeepSeek），仍能给出可用结构。
  // 与 explain 同理，三条拆开只为把原因记准；求值顺序与短路语义逐字保留
  //（allow() 与 withinDailyBudget() 都会消费计数，换位置就改了口径）。
  if (!KEY) {
    logDegrade("parse-intent", { kind: "no_key" });
    return NextResponse.json(fallback);
  }
  if (!allow(`parse:${clientKey(req)}`, 8, 10_000)) {
    logDegrade("parse-intent", { kind: "rate_limited" });
    return NextResponse.json(fallback);
  }
  if (!withinDailyBudget()) {
    logDegrade("parse-intent", { kind: "budget_exhausted" });
    return NextResponse.json(fallback);
  }

  const startedAt = Date.now();
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
        // 与 explain 同因：思考默认开着且推理 token 计入 max_tokens，200 的额度被推理吃光，
        // 实测每一次都是 `finish=length content=0 reasoning=381~436`——连一个 `{` 都没输出。
        // 这条路是把一句话归到八个 occasion 之一并填几个受控字段，推理帮不上忙。
        thinking: { type: "disabled" },
        max_tokens: 512,
        response_format: { type: "json_object" },
        stream: false,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      logDegrade(
        "parse-intent",
        { kind: "upstream_status", status: res.status, detail: await readUpstreamError(res) },
        Date.now() - startedAt
      );
      return NextResponse.json(fallback);
    }
    const data = await res.json();
    const choice = data?.choices?.[0];
    const raw = choice?.message?.content;
    // 容错：模型偶发在 json_object 外带 ```json 围栏或解释文字 → 截取首个 { 到末个 } 再解析，
    // 避免白白丢掉一次本可用的 LLM 结果、降到粗粒度启发式
    if (typeof raw !== "string") {
      logDegrade(
        "parse-intent",
        { kind: "bad_shape", at: "no_content", detail: describeChoice(choice) },
        Date.now() - startedAt
      );
      return NextResponse.json(fallback);
    }
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      // 空字符串也落在这里（indexOf 返回 -1）。finish_reason 与 reasoning 长度是分辨
      //「思考把 token 吃光了」和「模型没按 json_object 输出」的唯一依据。
      logDegrade(
        "parse-intent",
        { kind: "bad_shape", at: "no_json", detail: describeChoice(choice) },
        Date.now() - startedAt
      );
      return NextResponse.json(fallback);
    }
    // JSON.parse 单独包起来，不再让它落到外层 catch。行为不变（同一个 fallback），
    // 变的是记账：模型写出坏 JSON 是**模型输出不合格**，不是「上游坏了」，
    // 混进 upstream_error 会让告警指向一个没坏的 DeepSeek。
    let patch: unknown;
    try {
      patch = JSON.parse(raw.slice(start, end + 1));
    } catch {
      logDegrade("parse-intent", { kind: "bad_shape", at: "json_parse" }, Date.now() - startedAt);
      return NextResponse.json(fallback);
    }
    const parsed = PatchSchema.safeParse(patch);
    if (!parsed.success) {
      // 只记**字段路径**，不记 zod 的 received 值——那一侧是模型对用户原话的转写，
      // 是这条链路上唯一可能把用户写的话带进日志的地方。路径足够定位是哪个字段在漂。
      logDegrade(
        "parse-intent",
        {
          kind: "bad_shape",
          at: "schema",
          detail: parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(","),
        },
        Date.now() - startedAt
      );
      return NextResponse.json(fallback);
    }
    const merged = unionFragranceFree(parsed.data, fallback);
    // label 与提示口径对齐（≤12 字），与启发式兜底一致，防超长撑版
    return NextResponse.json({ ...parsed.data, ...merged, label: merged.label.slice(0, 12), source: "deepseek" });
  } catch (e) {
    logDegrade("parse-intent", classifyFetchError(e), Date.now() - startedAt);
    return NextResponse.json(fallback);
  }
}
