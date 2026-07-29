// 两条 API 路由里**承载红线的降级函数**的单测。
//
// 为什么单挑这两个：它们是没有 API key 时唯一会走到的路径——贡献者本地跑（README 明说
// 「没有 key 也能跑」）、线上限流/日闸门/上游超时之后，用户看到的都是它们的输出。
// 在这之前 476 行的三条路由一个用例都没有，"LLM 不可用时红线也不失效"这句承诺
// 只写在注释里、没有任何东西守着。
import { test } from "node:test";
import assert from "node:assert/strict";
import { heuristic, PatchSchema, unionFragranceFree } from "./parse-intent/route";
import { template, NEGATIVE_VERDICT_RE, type ExplainInput } from "./explain/route";
import { carriesNumber, extractDigits, findInventedNumbers, findPseudoPreciseCN } from "@/lib/numguard";

// ---------- parse-intent · 无香场合红线 ----------

test("启发式兜底：就医/探病的每一个说法都必须判成无香场合", () => {
  // 这十三个词是红线的全部入口。少一个，那类用户在 LLM 不可用时就会被推荐喷香水去医院。
  const words = ["医院", "看病", "就医", "门诊", "诊所", "探病", "住院", "病房", "体检", "陪诊", "化疗", "产检", "月子"];
  for (const w of words) {
    const r = heuristic(`下午去${w}`);
    assert.equal(r.fragranceFree, true, `「${w}」没有触发无香场合`);
    assert.equal(r.label, "就医探病·今天不用香", `「${w}」的标签不对：${r.label}`);
  }
});

test("启发式兜底：无香场合压过任何同时命中的普通场合，不被覆盖", () => {
  // 「陪朋友去医院」同时命中「朋友」(social) 和「医院」——顺序错了就会退化成"聚会·自在"。
  for (const text of ["陪朋友去医院", "下班后去医院看我妈", "见客户前先去趟体检", "约会前陪她去产检"]) {
    const r = heuristic(text);
    assert.equal(r.fragranceFree, true, `「${text}」被普通场合覆盖了`);
    assert.equal(r.label, "就医探病·今天不用香");
  }
});

test("启发式兜底：普通场合仍各归各位，无香判定不误伤", () => {
  assert.equal(heuristic("去前任的婚礼").occasion, "formal");
  assert.equal(heuristic("去前任的婚礼").tension, "high");
  assert.equal(heuristic("第一次见投资人").formality, 0.8);
  assert.equal(heuristic("晚上和喜欢的人看展").intimacy, "close");
  assert.equal(heuristic("周末去健身房").occasion, "sport");
  for (const t of ["去前任的婚礼", "第一次见投资人", "周末去健身房", "晚上朋友生日局"]) {
    assert.equal(heuristic(t).fragranceFree, false, `「${t}」被误判成无香场合`);
  }
});

test("无香场合取并集：LLM 漏判时关键词判定必须仍然作数", () => {
  // 这条守卫此前只写在启发式那条路上，而启发式**只在 LLM 不可用时才跑**——
  // 也就是说平时它一次都不生效，红线的可靠性全押在模型这一次记不记得给 fragranceFree。
  const fb = heuristic("下班后去医院看我妈"); // 关键词判定：true
  assert.equal(fb.fragranceFree, true);

  // ① 模型漏判 → 并集救回来，眉标也跟着兜底那句走，不留「探病·从容」配「今天不用香」的错位
  const missed = unionFragranceFree({ label: "探望家人·从容" }, fb);
  assert.equal(missed.fragranceFree, true, "模型漏判时关键词判定必须作数");
  assert.equal(missed.label, "就医探病·今天不用香");

  // ② 模型判对 → 用模型自己的 label（它读得懂上下文，比十三个关键词细）
  const hit = unionFragranceFree({ fragranceFree: true, label: "陪诊·今天不用香" }, fb);
  assert.deepEqual(hit, { fragranceFree: true, label: "陪诊·今天不用香" });

  // ③ 只有模型看出来的场合（关键词表里没有的说法）同样成立——并集只能加不能减
  const onlyLlm = unionFragranceFree({ fragranceFree: true, label: "术后探望·不用香" }, heuristic("去看刚做完手术的同事"));
  assert.equal(onlyLlm.fragranceFree, true);

  // ④ 普通场合不许被误伤
  const normal = unionFragranceFree({ label: "前任婚礼·得体克制" }, heuristic("去前任的婚礼"));
  assert.deepEqual(normal, { fragranceFree: false, label: "前任婚礼·得体克制" });
});

test("日闸门的环境变量不许有静默方向：留空得 0、写错得 NaN，两边都要被挡住", async () => {
  // 裸 Number() 有两个不会有人发现的失败形态：
  //   LLM_DAILY_CAP=       → 0     → 全站解读永久降级成模板，而 source 字段看不出区别；
  //   LLM_DAILY_CAP=3000次 → NaN   → `count >= NaN` 恒为 false，闸门被彻底关掉。
  const { capFrom } = await import("@/lib/ratelimit");
  const KEY = "FENCUN_CAP_PROBE";
  const cases: [string | undefined, number][] = [
    [undefined, 3000], // 没配
    ["", 3000], // 配了空串
    ["3000次", 3000], // 写错格式
    ["0", 3000], // 显式零：这是"关掉功能"，不该由一个额度变量表达
    ["-1", 3000],
    ["abc", 3000],
    ["500", 500], // 正常值照旧生效
    ["500.9", 500], // 取整
  ];
  for (const [raw, want] of cases) {
    if (raw === undefined) delete process.env[KEY];
    else process.env[KEY] = raw;
    assert.equal(capFrom(KEY, 3000), want, `${JSON.stringify(raw)} 应解析为 ${want}`);
  }
  delete process.env[KEY];
});

// ---------- explain · 降级模板 ----------

function mkInput(over: Partial<ExplainInput> = {}): ExplainInput {
  return {
    name: "烟草香草",
    brandZh: "汤姆·福特",
    accords: ["香草", "甜", "烟草"],
    styleTags: ["暖甜约会"],
    verdict: "good",
    scene: null,
    context: {
      city: "北京", tempC: 31, humidity: 55, weatherText: "晴",
      feel: "hot_dry", season: "summer", daypart: "day", occasion: "commute",
    },
    usage: {
      spraysLabel: "1 下", placement: ["腰侧", "衣物下摆内侧"],
      distance: "贴身可闻", durationHint: "大半个白天",
    },
    reasons: ["它偏厚重，今天的体感里要留意会不会闷"],
    risks: [],
    ...over,
  } as ExplainInput;
}

test("降级模板：avoid 必须先把「不建议」说出口，不得圆成可用", () => {
  // 这正是路由里 avoid 语义防线（正则）判定 LLM 输出是否合格的那条标准——
  // 模板自己必须无条件满足它，否则回退之后仍然说不出那句话。
  // 用路由导出的那个符号，不再抄第四份——三份字面量此前已经漂移过一次（good 那份少了两个分支）
  const t = template(mkInput({ verdict: "avoid", risks: ["大家更多在冬季用它，今天用会有点反季。"] }));
  assert.match(t, NEGATIVE_VERDICT_RE);
  assert.ok(t.includes("烟草香草"), "没点名是哪一瓶");
  assert.ok(t.includes("1 下"), "没给出降到最低的具体用法");
});

test("降级模板：无香场合不劝「你要是就想用它」——那句话在这里是有害的", () => {
  // placement 为空 = 引擎给的结论是"今天不用香"。此时再补一句"你要是就想用它"，
  // 等于把一条为他人着想的规则改写成了讨好用户。
  const t = template(
    mkInput({
      verdict: "avoid",
      usage: { spraysLabel: "0 下", placement: [], distance: "—", durationHint: "—" },
      risks: ["医院、诊所这类场合，很多人对气味格外敏感且无法回避。"],
    })
  );
  assert.ok(!t.includes("就想用它"), `无香场合不该劝用：${t}`);
  assert.equal(t, "医院、诊所这类场合，很多人对气味格外敏感且无法回避。");
});

test("降级模板：只复述给定事实，不得凭空生出数字——反伪精确在兜底路径上同样成立", () => {
  // 白名单口径与路由一致：允许的数字只能来自我们自己算出来的事实。
  const input = mkInput({ risks: ["甜和扩散都偏高，这类场合容易显得用力过猛。"] });
  const allowed = extractDigits(JSON.stringify(input));
  const out = template(input);
  assert.deepEqual(findInventedNumbers(out, allowed), [], `模板生出了白名单外的数字：${out}`);
});

test("降级模板：good 路径把喷量、部位、留香三件事都说全", () => {
  const t = template(mkInput());
  assert.ok(t.includes("1 下"), "缺喷量");
  assert.ok(t.includes("腰侧"), "缺喷洒部位");
  assert.ok(t.includes("大半个白天"), "缺留香");
  assert.ok(t.includes("北京") && t.includes("31"), "缺此刻的情境");
});

test("数字白名单：全角与中文数字同样是伪精确，不许绕过", () => {
  // JS 的 \d 恒等 [0-9]（与 u/v 标志无关），旧实现里全角与中文数字**根本不存在**：
  // 命中时返回空数组、整段照原样放行、source 还标成 deepseek。
  // 而 SYSTEM 提示词是中文的——模型写「能撑六到八个小时」比写「6.2 小时」自然得多。
  const facts = "喷 1–2 下；撑得住大半个白天；用两次你就知道它在你身上能走多久";
  const allowed = extractDigits(facts);

  // ① 半角：原本就拦得住，回归
  assert.deepEqual(findInventedNumbers("留香 6.2 小时", allowed), ["6.2"]);
  // ② 全角：两侧 NFKC 归一后走同一条
  assert.deepEqual(findInventedNumbers("留香 ６.２ 小时", allowed), ["6.2"]);
  // ③ 事实里给过的数字，全角写法也要放行——只归一输出不归一事实，会把自己的数字拦下来
  assert.deepEqual(findInventedNumbers("喷 １ 下", allowed), []);
  // ④ 中文数字 + 时间/剂量量词 = 伪精确
  assert.deepEqual(findPseudoPreciseCN("大概能撑六个小时", facts), ["六个小时"]);
  assert.deepEqual(findPseudoPreciseCN("补喷两毫升", facts), ["两毫升"]);
  // ⑤ 但逐字出现在事实里的中文数词必须放行，否则防线会把自己的事实吃掉——
  //    format.ts 的「用两次你就知道…」正是这一类，一律拦下就是永远静默退模板
  assert.deepEqual(findPseudoPreciseCN("用两次你就知道它在你身上能走多久", facts), []);
  // ⑥ 非计数的体感表达不在其列（它们本来就是我们自己的措辞）
  assert.deepEqual(findPseudoPreciseCN("撑得住大半个白天，一臂之内闻得到", facts), []);
});

test("数字白名单：「半」是数字，量词要盖住时间 · 剂量 · 距离三件事", () => {
  // 上一版漏掉的两类，实测都能原样上屏（invented 为空、source 标 deepseek）：
  //   ① 「半」不在数字表里 → 「六个半小时」「一个半小时」「半小时」全放行，
  //      而这比「六到八个小时」更像中文里的自然说法；
  //   ② 量词表没有「钟头」「秒」「泵」，距离侧更是一个长度单位都没有——
  //      而社交距离正是产品只给四档的三件事之一。
  const facts = "喷 1–2 下；撑得住大半个白天；用两次你就知道它在你身上能走多久";
  for (const s of [
    "大概能撑六个半小时",
    "差不多一个半小时就淡了",
    "大概能撑半小时",
    "大概六个钟头",
    "间隔三十秒再喷",
    "扩散半径一米五",
    "喷三泵就够",
  ]) {
    assert.ok(findPseudoPreciseCN(s, facts).length > 0, `该拦没拦：${s}`);
  }
  // 「大半」是我们自己的模糊措辞，不是伪精确——拦下它等于让防线吃掉自家的话
  assert.deepEqual(findPseudoPreciseCN("大半天都在，晚上多半还在", facts), []);
  assert.deepEqual(findPseudoPreciseCN("过几个小时你自己可能先闻不到", facts), []);
});

test("riskNote 带数字必须在源头丢掉——否则用户自己的输入会把白名单撑开", () => {
  // 链路：用户原话 → parse-intent 的 LLM → riskNote → computeRiskNotes 逐字进 risks[]
  //     → /api/explain 的 factsOnly → allowedNumbers。
  // 实测（修复前）：场景写「会议约 6.2 小时」，LLM 随后输出「留香 6.2 小时」时 invented = []。
  assert.equal(carriesNumber("会议约 6.2 小时，别太浓"), true);
  assert.equal(carriesNumber("会议室密闭，浓香会被放大"), false);
  assert.equal(carriesNumber("大概能撑六个半小时"), true);
  // 我们自己的模糊措辞不算"带数"，否则正常的 riskNote 会被误丢
  assert.equal(carriesNumber("婚礼焦点是新人，不宜喧宾夺主"), false);
  assert.equal(carriesNumber("大半天都在人多的地方"), false);

  // schema 层：带数字的整条丢掉，其余字段照常放行
  const dirty = PatchSchema.safeParse({ occasion: "formal", label: "会议", riskNote: "会议约 6.2 小时" });
  assert.equal(dirty.success, true);
  assert.equal(dirty.success && dirty.data.riskNote, undefined);
  const clean = PatchSchema.safeParse({ occasion: "formal", label: "会议", riskNote: "会议室密闭，浓香会被放大" });
  assert.equal(clean.success && clean.data.riskNote, "会议室密闭，浓香会被放大");
});

test("启发式兜底：也要给出在场时长档位，且没读懂时不许拿原话回显冒充理解", () => {
  // ① duration 此前这条路一个都不给，于是「在外时间不短，带上分装中途补 1 下更稳」
  //    在无 key / 限流 / 上游超时时整条消失——降级路径恰恰是最需要它的时候。
  const cases: [string, 2 | 4 | 6 | 9][] = [
    ["明天去参加婚礼", 4],
    ["第一次见投资人", 2],
    ["晚上和喜欢的人看展", 4],
    ["朋友生日局", 4],
    ["周末去健身房", 2],
    ["明天上班", 9],
  ];
  for (const [text, want] of cases) {
    assert.equal(heuristic(text).duration, want, `「${text}」的时长档位不对`);
  }

  // ② 一条规则都没命中时 matched=false。此前它照样返回 occasion="casual" + 原话回显的 label，
  //    屏上写着「氛寸读到 · <原话>」，而推荐其实是按 casual 算的——回显不是理解。
  const blank = heuristic("嗯嗯嗯");
  assert.equal(blank.matched, false, "什么都没命中却自称读懂了");
  assert.equal(blank.label, "嗯嗯嗯", "label 仍是原话回显（由前端按 matched 决定不采信）");

  // ③ 命中任意一条（含横切信号）就算读懂了一部分
  assert.equal(heuristic("明天上班").matched, true);
  assert.equal(heuristic("下午去医院").matched, true, "无香场合是横切信号，必须算命中");
  assert.equal(heuristic("和前任吃饭").matched, true, "张力与饭桌也是横切信号");
});

test("来源校验：一个第三方网页不该能从访客浏览器里调走我们的付费额度", async () => {
  // Content-Type: text/plain 让 POST 成为 CORS **简单请求**——不触发预检，
  // 任意页面都能对着两条付费路由发。限流键是访客自己的 IP，所以挂了脚本的页面
  // 有 N 个访客就等于 N 份合法额度；每实例日闸门又随并发上升，方向也是反的。
  const { fromOwnPage } = await import("@/lib/ratelimit");
  const req = (h: Record<string, string>) => new Request("https://x/api", { headers: new Headers(h) });

  // 真闸：跨源想带 application/json 就必须过预检，而我们不发任何 CORS 头
  assert.equal(fromOwnPage(req({ "content-type": "text/plain" })), false, "简单请求形态必须挡住");
  assert.equal(fromOwnPage(req({ "content-type": "application/x-www-form-urlencoded" })), false);
  assert.equal(fromOwnPage(req({})), false, "没有 Content-Type 也不放行");

  // 浏览器写的、页面脚本改不了的那一个
  assert.equal(
    fromOwnPage(req({ "content-type": "application/json", "sec-fetch-site": "cross-site" })),
    false,
    "浏览器已经说了这是跨站"
  );
  assert.equal(
    fromOwnPage(req({ "content-type": "application/json", "sec-fetch-site": "same-origin" })),
    true,
    "本站页面照常放行"
  );
  // 没有 Sec-Fetch-Site 的不拦：curl、老浏览器、自托管的健康检查都在这一类，
  // 那不是这条防线要解决的问题，交给限流
  assert.equal(fromOwnPage(req({ "content-type": "application/json; charset=utf-8" })), true);
});

test("数字白名单：数给过、单位换了，同样是伪精确", async () => {
  // 白名单只做集合成员判定，而事实包里恒有两个小整数是气温与湿度：
  // tempC 的 0~12 段像小时数，humidity 恒在 0~100 像分钟/厘米。模型不必编新数字，
  // 把我们给的数挪个槽位就够了——实测这三句原本全部放行、invented 为空、source 标 deepseek。
  const { allowedUnitPairs, findUnitMismatch } = await import("@/lib/numguard");
  const usage = { spraysLabel: "2–3 下", distance: "一臂", durationHint: "基本能陪你过完这一天的白天" };
  const risks = ["建议只喷 1 下（颈侧）"];
  const pairs = allowedUnitPairs(JSON.stringify({ 用法: usage, 风险提示: risks }));

  // 区间要按端点展开，否则会把我们自己给的档位判成编造
  assert.deepEqual([...pairs].sort(), ["1下", "2下", "3下"], "2–3 下要展开成 2 下与 3 下");

  assert.deepEqual(findUnitMismatch("留香 6 小时左右。", pairs), ["6 小时"], "6 原本是气温");
  assert.deepEqual(findUnitMismatch("扩散半径大约 40 厘米。", pairs), ["40 厘米"], "40 原本是湿度");
  assert.deepEqual(findUnitMismatch("建议喷 6 下。", pairs), ["6 下"], "喷量档位我们只给了 1/2/3");

  // 反向：自家措辞一律不许误伤（全目录 52500 条真实模板输出实测零拦截）
  assert.deepEqual(findUnitMismatch("建议喷 2 下，喷在颈侧、手腕。", pairs), []);
  assert.deepEqual(findUnitMismatch("今天这么热，建议只喷 1 下（颈侧）。", pairs), []);
  assert.deepEqual(findUnitMismatch("今天北京晴、6℃，湿度 40。", pairs), [], "温度与湿度读数不带量词，不在管辖内");
});
