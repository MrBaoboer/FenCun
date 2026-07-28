// 两条 API 路由里**承载红线的降级函数**的单测。
//
// 为什么单挑这两个：它们是没有 API key 时唯一会走到的路径——贡献者本地跑（README 明说
// 「没有 key 也能跑」）、线上限流/日闸门/上游超时之后，用户看到的都是它们的输出。
// 在这之前 476 行的三条路由一个用例都没有，"LLM 不可用时红线也不失效"这句承诺
// 只写在注释里、没有任何东西守着。
import { test } from "node:test";
import assert from "node:assert/strict";
import { heuristic } from "./parse-intent/route";
import { template, type ExplainInput } from "./explain/route";
import { extractDigits, findInventedNumbers, findPseudoPreciseCN } from "@/lib/numguard";

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
  const t = template(mkInput({ verdict: "avoid", risks: ["大家更多在冬季用它，今天用会有点反季。"] }));
  assert.match(t, /不建议|不太建议|不太合适|不合适|不宜|慎|其实不/);
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
