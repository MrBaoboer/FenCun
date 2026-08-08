// 降级可观测性：让「按设计降级」与「上游坏了」在日志里分得开。
//
// 两条 LLM 路由此前有八个 `return 兜底` 的分支，其中只有数字白名单那一条记日志。
// 于是「线上 DeepSeek 一次都没打通」与「贡献者本地没配 key」在外部完全同形：
// HTTP 都是 200，body 都带 source: "template" / "heuristic"，Vercel 日志里一片空白。
// 唯一的判据是人肉点开页面，看眉标写的是「氛寸 · 此刻为你解读」还是「氛寸 · 用香建议」
//（RecommendationCard.tsx 的三分支）——那不是可观测性，那是运气。
//
// 隔壁 /api/context 早有 `console.error("[api/context] upstream error:", …)`：
// 三条代理付费上游的路由里，只有这两条是哑的。这个文件把那条约定补齐，并且分级。
//
// 两条硬约束贯穿全文件：
// · **绝不写 key**——redact() 在所有 detail 上强制跑一遍，且只取上游的结构化 error.message；
// · **绝不写用户原话**——detail 的来源被限死在「上游自己的错误消息」「zod 的字段路径」
//   「被拦下的数字 token」三类，没有任何一条能把 rawText 带进日志。

/** 一次降级的原因。kind 是给 grep 用的，其余字段是给人看的。 */
export type DegradeReason =
  | { kind: "no_key" }
  | { kind: "rate_limited" }
  | { kind: "budget_exhausted" }
  | { kind: "upstream_status"; status: number; detail?: string }
  | { kind: "timeout" }
  | { kind: "upstream_error"; detail: string }
  | { kind: "bad_shape"; at: string; detail?: string }
  | { kind: "guard"; at: string; detail?: string };

export type DegradeKind = DegradeReason["kind"];

/**
 * 分级的口径只有一句话：**这条线要不要有人去看**。
 *
 * error —— 上游坏了。key 无效、余额不足、超时、连不通：不修就永远降级，且用户完全无感。
 * warn  —— 按设计降级。没配 key（README 明说没有 key 也能跑）、限流、日闸门触顶、
 *          模型输出不合格被防线拦下：系统正在按预期工作，但频率本身是信号。
 *
 * 把 guard 归到 warn 而不是 error，是因为它恰恰证明防线在生效；把 no_key 归到 warn
 * 而不是 error，是因为本地开发那条路是我们自己承诺支持的。
 */
export function levelOf(kind: DegradeKind): "error" | "warn" {
  return kind === "upstream_status" || kind === "timeout" || kind === "upstream_error"
    ? "error"
    : "warn";
}

/**
 * 凭据形态的串一律抹掉。
 *
 * 不是假想的风险：DeepSeek 的 401 错误体历来把 key 回显在消息里
 *（"Authentication Fails, Your api key: sk-… is invalid"），而我们要记的正是这条消息。
 * 第三条规则是兜底——任何 ≥24 位的不透明串都当凭据处理，宁可少读一点上游细节。
 */
const SECRETISH: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{4,}/g, // DeepSeek / OpenAI 形态
  /\bBearer\s+\S+/gi,
  /[A-Za-z0-9_-]{24,}/g,
];

export function redact(s: string): string {
  let out = s;
  for (const re of SECRETISH) out = out.replace(re, "***");
  return out;
}

/** detail 的硬上限。上游错误消息本来就短；截断是为了防止任何形态的长文本混进日志。 */
const DETAIL_MAX = 200;

/**
 * 日志行本身。纯函数、零副作用，导出是为了可测——
 * 「不许把 key 写进日志」这条约束必须有东西守着，而不是靠 review 时肉眼扫一遍。
 *
 * 形态刻意做成 `key=value`，方便在 Vercel 日志里直接按 `降级 upstream_status` 或
 * `status=401` 过滤，也方便日后接任何一个日志聚合。
 */
export function degradeLine(route: string, reason: DegradeReason, ms?: number): string {
  const parts = [`[${route}] 降级 ${reason.kind}`];
  if (reason.kind === "upstream_status") parts.push(`status=${reason.status}`);
  if ("at" in reason) parts.push(`at=${reason.at}`);
  // 耗时是区分「快速 401」与「上游卡死」的关键——两者的 kind 不同，但排查时先看的是这个数。
  if (typeof ms === "number" && Number.isFinite(ms)) parts.push(`ms=${Math.round(ms)}`);
  const detail = "detail" in reason ? reason.detail : undefined;
  if (detail) parts.push(`detail=${JSON.stringify(redact(detail).slice(0, DETAIL_MAX))}`);
  return parts.join(" ");
}

/**
 * 节流。补日志不能顺手补出一条日志放大路径。
 *
 * · no_key / budget_exhausted：**每实例只记一次**。KEY 是模块级常量，日闸门触顶后
 *   当天余下每一个请求都会再撞一次——重复一万遍不会比第一遍多告诉你任何事。
 * · rate_limited：60 秒一条。它由客户端行为触发、次数无上限，一个脚本就能把日志刷爆；
 *   而排查真正需要的是「这段时间里有人在刷」，不是每一次拒绝的流水。
 * · 其余（上游坏了、防线拦截）：每次都记。它们的**频率**就是信号，压掉就没了。
 *
 * 键只由调用方写死的 route 与固定的 kind 拼成，取值有限（路由数 × 8），
 * 不含任何用户可控的值，所以这个 Map 不会增长——与 ratelimit.ts 那个按 IP 建键的
 * 不同，这里不需要清理逻辑。
 */
const NEVER_AGAIN = Number.POSITIVE_INFINITY;
const THROTTLE_MS: Record<DegradeKind, number> = {
  no_key: NEVER_AGAIN,
  budget_exhausted: NEVER_AGAIN,
  rate_limited: 60_000,
  upstream_status: 0,
  timeout: 0,
  upstream_error: 0,
  bad_shape: 0,
  guard: 0,
};

const lastLoggedAt = new Map<string, number>();

/** 导出是为了可测：节流策略本身就是这次改动的一半，它不该只在集成里被间接验证。 */
export function shouldLog(key: string, everyMs: number, now: number = Date.now()): boolean {
  if (everyMs <= 0) return true;
  const prev = lastLoggedAt.get(key);
  if (prev !== undefined && now - prev < everyMs) return false;
  lastLoggedAt.set(key, now);
  return true;
}

export function logDegrade(route: string, reason: DegradeReason, ms?: number): void {
  if (!shouldLog(`${route}:${reason.kind}`, THROTTLE_MS[reason.kind])) return;
  const line = degradeLine(route, reason, ms);
  if (levelOf(reason.kind) === "error") console.error(line);
  else console.warn(line);
}

/**
 * fetch 抛出来的东西 → 一条能定位的原因。纯函数，导出是为了可测。
 *
 * 三类要分开，否则「打不通 DeepSeek」和「打通了但它返回了错」会记成同一句话：
 * · AbortSignal.timeout() 中断 → DOMException("TimeoutError")，这是我们自己设的 12s / 15s；
 * · 网络层错误 → undici 统一包成 `TypeError: fetch failed`，真正的原因藏在 cause.code
 *   （ENOTFOUND / ECONNREFUSED / UND_ERR_CONNECT_TIMEOUT …）。只记外层消息等于什么都没记；
 * · 其余（如 200 但响应体不是 JSON，res.json() 抛 SyntaxError）→ 记名字与消息。
 *
 * message 也要过 redact()：它不含用户输入，但 Authorization 头出现在某些底层错误里，
 * 这条防线的成本是一次正则，没有理由省。
 */
export function classifyFetchError(e: unknown): DegradeReason {
  const err = e as { name?: unknown; message?: unknown; cause?: unknown } | null | undefined;
  const name = typeof err?.name === "string" ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") return { kind: "timeout" };
  const cause = err?.cause as { code?: unknown } | undefined;
  const code = typeof cause?.code === "string" ? cause.code : "";
  const message = typeof err?.message === "string" ? err.message : String(e);
  return {
    kind: "upstream_error",
    detail: code ? `${name || "Error"}/${code}` : `${name || "Error"}: ${message}`,
  };
}

/**
 * 「上游 200 了，但没给出能用的东西」时，把那一次到底发生了什么记下来。
 *
 * 这三个字段是分辨以下几种情形的**唯一**依据，而它们彼此的处置完全不同：
 * · finish=length + reasoning 很长 + content=0 —— 思考型模型把 max_tokens 全花在
 *   推理上了，正文一个字没轮到。修法是抬 max_tokens 或关思考，不是去查网络；
 * · finish=stop + content=0 —— 模型真的什么都没说；
 * · finish=content_filter —— 被上游的安全策略挡了；
 * · content 有长度但 parse-intent 说 no_json —— 模型没按 json_object 输出。
 *
 * 只记**枚举值与字符数**，不记任何一个字。content 与 reasoning 都由模型对用户
 * 原话的转写构成，长度是安全的，内容不是。
 */
export function describeChoice(choice: unknown): string {
  const c = choice as
    | { finish_reason?: unknown; message?: { content?: unknown; reasoning_content?: unknown } }
    | undefined;
  const finish = typeof c?.finish_reason === "string" ? c.finish_reason : "?";
  const len = (v: unknown) => (typeof v === "string" ? v.length : -1);
  return `finish=${finish} content=${len(c?.message?.content)} reasoning=${len(c?.message?.reasoning_content)}`;
}

/**
 * 上游错误体里最有诊断价值的那一小段。
 *
 * 401 与 402 的区别（key 无效 / 余额不足）只写在这条消息里，而状态码本身分不出
 * 「key 打错了」和「key 对但欠费」。所以要读，但**只读结构化的那一个字段**：
 * 非预期形态一律只记长度，不把上游返回的任意文本原样搬进日志——那是唯一可能
 * 把请求内容回显出来的路径，堵死它比事后截断可靠。
 */
export async function readUpstreamError(res: Response): Promise<string> {
  try {
    const raw = (await res.text()).slice(0, 1000);
    try {
      const j = JSON.parse(raw) as { error?: { message?: unknown }; message?: unknown };
      const m = j?.error?.message ?? j?.message;
      if (typeof m === "string") return m;
    } catch {
      // 不是 JSON：走下面那条只记长度的路
    }
    return `非 JSON 错误体 ${raw.length}B`;
  } catch {
    return "";
  }
}
