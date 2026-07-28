// 打分/用法/编排引擎单测 —— 确定性纯函数，锁定权重、乘子方向与边界，防重构悄悄改错。
// 运行：npm test（node --import tsx --test）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  score,
  seasonFit,
  daypartFit,
  weatherMultiplier,
  weatherFit,
  occasionFit,
  qualityPrior,
  avoidPenalty,
  familyDominance,
  DOMINANT,
} from "./scoring";
import { computeUsage, computeRisks } from "./usage";
import { buildPick, recommend, freshness, swapPenalty, dayFloor, aggregateBias } from "./recommend";
import { feelFromWeather, mustyAir } from "./season";
import { extractDigits, findInventedNumbers } from "./numguard";
import type { Perfume, Context, Feedback } from "./types";

function mk(o: Partial<Perfume> = {}): Perfume {
  return {
    id: 1,
    name: "T",
    nameZh: "测试",
    aliases: [],
    brand: "B",
    brandZh: "品牌",
    gender: "unisex",
    year: 2020,
    rating: 4,
    longevity: 3,
    sillage: 2.5,
    sillageTier: 2,
    priceValue: 3,
    seasonPct: { winter: 0.25, spring: 0.25, summer: 0.25, autumn: 0.25 },
    daypartPct: { day: 0.5, night: 0.5 },
    accords: [],
    notes: { top: [], middle: [], base: [] },
    notesFlat: [],
    styleTags: [],
    popularity: 100,
    people: 100,
    ...o,
  };
}
function acc(list: [string, number][]): Perfume["accords"] {
  return list.map(([en, strength]) => ({ en, zh: en, strength }));
}
function C(o: Partial<Context> = {}): Context {
  return {
    tempC: 20,
    humidity: 50,
    windSpeed: 0,
    weatherText: "",
    city: "",
    feel: "mild",
    daypart: "day",
    season: "spring",
    occasion: "casual",
    ...o,
  };
}

test("加性权重归一：W=Q=1、无偏移时 total 恰为 0.38·季 + 0.19·时段 + 0.43·场合", () => {
  const p = mk({
    rating: null,
    seasonPct: { winter: 0.1, spring: 0.4, summer: 0.3, autumn: 0.2 },
    daypartPct: { day: 0.7, night: 0.3 },
    accords: acc([["sweet", 40]]),
  });
  const c = C({ feel: "mild", tempC: 19, season: "spring", daypart: "day", occasion: "date" });
  const parts = score(p, c);
  const expected = 0.38 * parts.season + 0.19 * parts.daypart + 0.43 * parts.occasion;
  assert.ok(Math.abs(parts.total - expected) < 1e-9, `total=${parts.total} expected=${expected}`);
  assert.equal(parts.weather, 1); // mild 中段无梯度
  assert.equal(parts.quality, 1); // rating null → 不惩罚
});

test("seasonFit：票数充足时主场季≈1、反季按相对占比，且主场恒高于反季", () => {
  const p = mk({ people: 20000, seasonPct: { winter: 0.1, spring: 0.1, summer: 0.6, autumn: 0.2 } });
  assert.ok(seasonFit(p, "summer") > 0.99, `主场季应≈1，得 ${seasonFit(p, "summer")}`);
  assert.ok(seasonFit(p, "winter") < 0.2, `反季应显著低，得 ${seasonFit(p, "winter")}`);
  assert.ok(seasonFit(p, "summer") > seasonFit(p, "autumn"));
  assert.ok(seasonFit(p, "autumn") > seasonFit(p, "winter"));
});

test("daypartFit：票数充足时主场≈1，另一端按相对占比", () => {
  const p = mk({ people: 20000, daypartPct: { day: 0.2, night: 0.8 } });
  assert.ok(daypartFit(p, C({ daypart: "night" })) > 0.99);
  assert.ok(daypartFit(p, C({ daypart: "day" })) < 0.3);
});

test("「没数据」不等于「满分」：平坦分布/手动记录落在全库均值，不再打平完美对季的香(P0-4)", () => {
  // 手动记录：seasonPct 是我们诚实填的 0.25×4。旧公式 当前季÷最高季 恒得 1.0——
  // 一瓶我们一无所知的香，季节项上打平一瓶两万票认证的完美对季香。
  const custom = mk({ id: -1, custom: true, people: 0, rating: null });
  const perfect = mk({ id: 2, people: 20000, seasonPct: { winter: 0.05, spring: 0.05, summer: 0.8, autumn: 0.1 } });
  const sc = seasonFit(custom, "summer");
  const sp = seasonFit(perfect, "summer");
  assert.ok(sc < 0.8, `手动记录不该拿高分，得 ${sc}`);
  assert.ok(sp > sc + 0.25, `完美对季(${sp}) 必须明显高于无数据(${sc})`);
  // 但也不该被打成反季那么低——"不知道"落在平均，不是落在最差
  assert.ok(sc > seasonFit(perfect, "winter"), "无数据应优于确知的反季");
  // 时段同理
  assert.ok(daypartFit(custom, C({ daypart: "night" })) < 0.95);
});

test("低票扩展集同样被收缩：三五票的尖峰不算强信号(P0-4)", () => {
  const peak = { winter: 0.05, spring: 0.05, summer: 0.8, autumn: 0.1 };
  const fewVotes = seasonFit(mk({ people: 3, seasonPct: peak }), "summer");
  const manyVotes = seasonFit(mk({ people: 20000, seasonPct: peak }), "summer");
  assert.ok(fewVotes < manyVotes - 0.2, `3 票(${fewVotes}) 的话语权必须远低于 2 万票(${manyVotes})`);
});

test("weatherMultiplier：闷热压厚重、奖清新", () => {
  assert.ok(weatherMultiplier(mk({ accords: acc([["amber", 60]]) }), "hot_humid") < 1);
  assert.ok(weatherMultiplier(mk({ accords: acc([["citrus", 60]]) }), "hot_humid") > 1);
});

test("weatherMultiplier：寒冷奖暖香，纯柑橘/古龙受罚(domain-3)", () => {
  assert.ok(weatherMultiplier(mk({ accords: acc([["amber", 60]]) }), "cold") > 1);
  assert.ok(weatherMultiplier(mk({ accords: acc([["citrus", 90]]) }), "cold") < 1);
});

test("weatherMultiplier：冷天不无差别加成裸木质，仅暖木组合受奖(domain-2)", () => {
  const dryWoody = mk({ accords: acc([["woody", 80]]) }); // 无暖调 → 干冷木，不算暖香
  assert.equal(weatherMultiplier(dryWoody, "cold"), 1);
  const warmWoody = mk({ accords: acc([["woody", 80], ["amber", 45]]) });
  assert.ok(weatherMultiplier(warmWoody, "cold") > 1);
});

test("weatherMultiplier：mild 中段恒 1、两端有温和梯度，且始终在 [0.7,1.3]", () => {
  const fresh = mk({ accords: acc([["citrus", 60]]) });
  const heavy = mk({ accords: acc([["amber", 60]]) });
  assert.equal(weatherMultiplier(fresh, "mild", 20), 1);
  assert.ok(weatherMultiplier(fresh, "mild", 25) > 1);
  assert.ok(weatherMultiplier(heavy, "mild", 25) < 1);
  const w = weatherMultiplier(mk({ accords: acc([["amber", 90], ["oud", 90]]) }), "hot_humid");
  assert.ok(w >= 0.7 && w <= 1.3);
});

test("天气乘子连续化：温度/湿度阈值处不得出现断崖，高温段不得塌缩", () => {
  // 旧的离散分档在三处制造了真实可感的跳变，而且方向恰好是错的：
  //   27.9℃(mild ×0.96) → 28.0℃(hot_dry ×0.88)：0.1℃ 换 8 个百分点；
  //   28℃/64%(×0.88) → 28℃/66%(×0.84)：湿度在这一带根本没有被验证过的效应量；
  //   34℃ 与 28℃ 拿到完全相同的乘子——温度是唯一方向可靠的变量，却在最需要区分处被抹平。
  // 本文件自己的 occasionFit 注释就写着「连续函数，不设悬崖」，同一份代码不该两套标准。
  const heavy = mk({ people: 20000, accords: acc([["amber", 70]]) });
  const W = (t: number, h: number) => weatherMultiplier(heavy, feelFromWeather(t, h), t, h);

  // ① 温度阈值两侧：0.2℃ 的跨度不得带来 1 个百分点以上的变化
  assert.ok(Math.abs(W(27.9, 70) - W(28.1, 70)) < 0.01, `28℃ 断崖仍在：${W(27.9, 70)} vs ${W(28.1, 70)}`);
  // ② 湿度阈值两侧同理
  assert.ok(Math.abs(W(28, 64) - W(28, 66)) < 0.01, `65% 断崖仍在：${W(28, 64)} vs ${W(28, 66)}`);
  // ③ 冷侧阈值两侧
  const warm = mk({ people: 20000, accords: acc([["amber", 70]]) });
  const Wc = (t: number) => weatherMultiplier(warm, feelFromWeather(t, 55), t, 55);
  assert.ok(Math.abs(Wc(10.1) - Wc(9.9)) < 0.01, `10℃ 断崖仍在：${Wc(10.1)} vs ${Wc(9.9)}`);

  // ④ 高温段必须继续加强，不能 34℃ ≡ 28℃
  assert.ok(W(34, 70) < W(28, 70) - 0.03, `34℃(${W(34, 70)}) 必须明显强于 28℃(${W(28, 70)})`);
  // ⑤ 全程单调：温度越高，厚重香越受压
  for (let t = 22; t <= 36; t += 1) {
    assert.ok(W(t + 1, 70) <= W(t, 70) + 1e-9, `${t}→${t + 1}℃ 非单调`);
  }
  // ⑥ clamp 仍是安全网而非常态：实际取值不该贴到边界
  assert.ok(W(40, 95) > 0.7, "clamp 下界不该被触发");
});

test("occasionFit：约会奖甜；运动重罚厚重但保序、不塌成同分(algo-5)", () => {
  assert.ok(occasionFit(mk({ accords: acc([["sweet", 80]]) }), C({ occasion: "date" })) > 0.5);
  const s90 = occasionFit(mk({ accords: acc([["sweet", 90]]), sillageTier: 3 }), C({ occasion: "sport" }));
  const s70 = occasionFit(mk({ accords: acc([["sweet", 70]]), sillageTier: 3 }), C({ occasion: "sport" }));
  assert.ok(s90 > 0 && s70 > 0, "软下限恒正");
  assert.ok(s90 < s70, "更甜 → 运动更不合适");
  assert.notEqual(s90, s70, "低分区仍保序，不撞同一底板");
});

test("avoidPenalty：too_sweet 压甜香；无 avoid 不变", () => {
  const sweet = mk({ accords: acc([["sweet", 60]]) });
  assert.ok(avoidPenalty(sweet, ["too_sweet"]) < 1);
  assert.equal(avoidPenalty(sweet, undefined), 1);
});

test("qualityPrior：null→1，且始终夹在 [0.96,1.04]", () => {
  assert.equal(qualityPrior(mk({ rating: null })), 1);
  const hi = qualityPrior(mk({ rating: 4.8, people: 5000 }));
  const lo = qualityPrior(mk({ rating: 3.0, people: 5000 }));
  assert.ok(hi >= 1 && hi <= 1.04);
  assert.ok(lo >= 0.96 && lo <= 1);
});

test("computeVerdict：tier4 遇封闭场合判 avoid（不迁就）", () => {
  const loud = mk({ sillageTier: 4 });
  assert.equal(buildPick(loud, C({ occasion: "work", feel: "mild", tempC: 20 })).verdict, "avoid");
});

test("recommend：单一品牌库仍返回 3 个备选、不丢第 2 名(algo-1)", () => {
  const lib = [0, 1, 2, 3, 4].map((i) =>
    mk({ id: i, brand: "B", rating: null, accords: acc([["sweet", 80 - i * 10]]) })
  );
  const c = C({ season: "spring", feel: "mild", tempC: 20, occasion: "date" });
  const { primary, alternatives, ranked } = recommend(lib, c);
  assert.ok(primary);
  assert.equal(alternatives.length, 3);
  assert.equal(primary!.perfume.id, ranked[0].perfume.id);
  assert.ok(alternatives.some((a) => a.perfume.id === ranked[1].perfume.id), "全库第2名必须在备选里");
  const ids = new Set(alternatives.map((a) => a.perfume.id));
  assert.equal(ids.size, 3, "备选互不重复");
  assert.ok(!ids.has(primary!.perfume.id), "备选不含主推自己");
});

test("computeUsage：tier4 在封闭场合，社交距离档随喷量下调(domain-1)", () => {
  const loud = mk({ sillageTier: 4, sillage: 3.5 });
  assert.ok(computeUsage(loud, C({ occasion: "work", feel: "mild", tempC: 20 })).socialDistance < 4);
  assert.equal(computeUsage(loud, C({ occasion: "home", feel: "mild", tempC: 20 })).socialDistance, 4);
});

// ============ 审查修复回归测试：每条对应一个曾被实锤的缺陷 ============

test("排序不变式：任何后位候选的排名分不得高出前位超过 EPS（修 epsilon 比较器违反严格弱序）", () => {
  // 同质香柜：相邻分差 < EPS、首尾跨度 > EPS——旧比较器在此结构下会让分高者排后
  const lib = Array.from({ length: 8 }, (_, i) =>
    mk({ id: i + 1, brand: "B", rating: null, accords: acc([["sweet", 80 - i * 2]]) })
  );
  const c = C({ season: "spring", feel: "mild", tempC: 20, occasion: "date" });
  for (let seed = 0; seed < 40; seed++) {
    const { ranked } = recommend(lib, c, undefined, { daySeed: seed });
    for (let i = 0; i < ranked.length; i++) {
      for (let j = i + 1; j < ranked.length; j++) {
        assert.ok(
          ranked[j].score <= ranked[i].score + 0.012 + 1e-9,
          `seed=${seed}: 位次 ${j}(${ranked[j].score.toFixed(4)}) 比位次 ${i}(${ranked[i].score.toFixed(4)}) 高出超过 EPS`
        );
      }
    }
  }
});

test("喷量不变式：任何修正组合下 lo ≤ hi（修「2–1 下」反向区间）", () => {
  // 复现原 bug：贴身意图把 hi 压到 lo，再叠一次「太冲」反馈
  const p = mk({ sillage: 2.0, sillageTier: 2 });
  const u = computeUsage(p, C({ occasion: "date", intimacy: "close", feel: "mild", tempC: 20 }), {
    likeScore: 0,
    perceivedStrength: 0.5,
  });
  assert.ok(u.sprays[0] <= u.sprays[1], `反向区间: ${u.spraysLabel}`);
  // 粗暴遍历：全场合 × 全体感 × 反馈强度，不变式必须恒成立
  for (const occasion of ["commute", "work", "date", "social", "formal", "casual", "home", "sport"] as const) {
    for (const feel of ["hot_humid", "hot_dry", "mild", "cold"] as const) {
      for (const ps of [-1, -0.5, 0, 0.5, 1]) {
        for (const intimacy of ["close", "neutral", "broadcast"] as const) {
          const x = computeUsage(
            mk({ sillage: 3.5, sillageTier: 4, accords: acc([["sweet", 70], ["white floral", 60]]) }),
            C({ occasion, feel, intimacy, tempC: 25, avoid: ["too_strong"], meal: true }),
            { likeScore: 0, perceivedStrength: ps }
          );
          assert.ok(x.sprays[0] <= x.sprays[1] && x.sprays[0] >= 1);
        }
      }
    }
  }
});

test("闷热压重香不再是死代码：强扩散香在 hot_humid 下喷量上限低于 mild（修 usage.ts:38）", () => {
  const loud = mk({ sillage: 3.5, sillageTier: 4 });
  const mild = computeUsage(loud, C({ occasion: "casual", feel: "mild", tempC: 20 }));
  const humid = computeUsage(loud, C({ occasion: "casual", feel: "hot_humid", tempC: 32 }));
  assert.ok(humid.sprays[1] < mild.sprays[1], `hot_humid=${humid.spraysLabel} vs mild=${mild.spraysLabel}`);
});

test("dayFloor：同一本地日内种子稳定，跨本地午夜才变（修 UTC 早八点突变）", () => {
  const morning = new Date(2026, 6, 8, 7, 50).getTime();
  const later = new Date(2026, 6, 8, 8, 10).getTime();
  const nextDay = new Date(2026, 6, 9, 0, 10).getTime();
  assert.equal(dayFloor(morning), dayFloor(later)); // 7:50 与 8:10 是同一天（旧实现在 UTC 零点=北京 8 点翻转）
  assert.notEqual(dayFloor(morning), dayFloor(nextDay));
});

test("qualityPrior：收缩靶心与中性锚点统一——中评少票不再比无评分更差", () => {
  const midFewVotes = qualityPrior(mk({ rating: 4.0, people: 50 }));
  const unrated = qualityPrior(mk({ rating: null }));
  assert.ok(Math.abs(midFewVotes - 1) < 1e-9, `rating=4.0 应精确中性，得 ${midFewVotes}`);
  assert.equal(unrated, 1);
});

test("occasionFit：琥珀木质加分在 60 附近连续，无悬崖跳变", () => {
  const at60 = occasionFit(mk({ accords: acc([["amber", 60]]) }), C({ occasion: "date" }));
  const at61 = occasionFit(mk({ accords: acc([["amber", 61]]) }), C({ occasion: "date" }));
  assert.ok(Math.abs(at60 - at61) < 0.005, `60→61 跳变 ${Math.abs(at60 - at61)}`);
});

test("feelFromWeather：22℃/90% 不再被判成闷热——它和 30℃/70% 干球温差 8℃，不是同一件事", () => {
  // 曾经的规则：tempC>=20 && humidity>=85 → hot_humid（"回南天/梅雨"）。
  // 循证复核推翻了它的机制（"湿空气裹住香气分子"物理上不成立），
  // 而分档本身的问题更直接：8℃ 的干球温差不该被抹平成同一个体感。
  assert.equal(feelFromWeather(22, 90), "mild");
  assert.equal(feelFromWeather(22, 60), "mild");
  assert.equal(feelFromWeather(30, 70), "hot_humid");
  assert.equal(feelFromWeather(30, 40), "hot_dry");
  // 回南天真正的问题是霉潮本底气味，属文案层，不进打分
  assert.equal(mustyAir(22, 92), true);
  assert.equal(mustyAir(30, 92), false, "盛夏高温高湿不是回南天");
  assert.equal(mustyAir(22, 70), false);
});

test("高温防护不再是湿热专属：干热同样压强扩散香的喷量与分数", () => {
  // 主变量是温度不是湿度。此前 hot_dry 档几乎没有任何减量保护。
  const loud = mk({ people: 20000, sillage: 3.5, sillageTier: 4 });
  const mild = computeUsage(loud, C({ occasion: "casual", feel: "mild", tempC: 20 }));
  const dry = computeUsage(loud, C({ occasion: "casual", feel: "hot_dry", tempC: 33 }));
  assert.ok(dry.sprays[1] < mild.sprays[1], `干热也该压喷量：mild=${mild.spraysLabel} dry=${dry.spraysLabel}`);
  // 分数侧：厚重香在干热同样受罚，但罚得比湿热轻（湿热多出的是热舒适度惩罚）
  const heavy = mk({ people: 20000, accords: acc([["amber", 70]]) });
  const wDry = weatherMultiplier(heavy, "hot_dry");
  const wHumid = weatherMultiplier(heavy, "hot_humid");
  assert.ok(wDry < 1, "干热应压厚重香");
  assert.ok(wHumid < wDry, "湿热罚得更重，但差距只有几个点");
  assert.ok(wDry - wHumid < 0.08, "两档差距不该再是拍出来的 10 点");
  // 部位也一并挪到更凉的落点
  assert.ok(dry.placement.some((x) => x.includes("衣物") || x.includes("耳后")));
});

test("freshness：当天=1（今天的答案不摇摆），隔天让位，一周后归位；没喷过=1", () => {
  const now = new Date(2026, 6, 8, 9, 0).getTime();
  const DAY = 24 * 3600 * 1000;
  assert.equal(freshness(undefined, now), 1);
  assert.equal(freshness(now - 3600e3, now), 1); // 今早刚采纳
  const d1 = freshness(now - 1 * DAY, now);
  const d2 = freshness(now - 2 * DAY, now);
  const d7 = freshness(now - 7 * DAY, now);
  assert.ok(d1 < d2 && d2 < d7, "隔的天数越多越接近 1");
  assert.ok(d1 < 0.65 && d7 > 0.9);
});

test("recommend：昨天刚喷的那瓶让位给同分兄弟（轮换因子进排序）", () => {
  const a = mk({ id: 1, rating: null, accords: acc([["citrus", 60]]) });
  const b = mk({ id: 2, rating: null, accords: acc([["citrus", 60]]) });
  const now = new Date(2026, 6, 8, 9, 0).getTime();
  const worn = new Map([[1, now - 24 * 3600 * 1000]]);
  const { primary } = recommend([a, b], C({ occasion: "casual", feel: "mild", tempC: 20 }), undefined, {
    lastWornAt: worn,
    now,
    daySeed: 3,
  });
  assert.equal(primary!.perfume.id, 2, "昨天喷过的 1 号应让位");
});

test("swapPenalty：7 天内两个不同天被换掉 → 0.8；单次或过期不罚", () => {
  const now = new Date(2026, 6, 8, 9, 0).getTime();
  const DAY = 24 * 3600 * 1000;
  assert.equal(swapPenalty(undefined, now), 1);
  assert.equal(swapPenalty([now - DAY], now), 1);
  assert.equal(swapPenalty([now - DAY, now - DAY + 3600e3], now), 1); // 同一天两次只算一天
  assert.equal(swapPenalty([now - DAY, now - 2 * DAY], now), 0.8);
  assert.equal(swapPenalty([now - 8 * DAY, now - 9 * DAY], now), 1); // 过期失效
});

function fb(o: Partial<Feedback> & { rating: Feedback["rating"] }): Feedback {
  return {
    perfumeId: 1,
    at: Date.now(),
    context: { season: "spring", daypart: "day", tempC: 20, occasion: "work", feel: "mild" },
    ...o,
  } as Feedback;
}

test("aggregateBias：环境归因的「淡了」不进喷量校准（那笔算天气的）", () => {
  const now = Date.now();
  const plain = aggregateBias([fb({ rating: "too_weak", at: now })], now).get(1)!;
  const attributed = aggregateBias([fb({ rating: "too_weak", at: now, tags: ["env_attributed"] })], now).get(1)!;
  assert.ok(plain.perceivedStrength < 0, "正常「淡了」应记为偏淡");
  assert.equal(attributed.perceivedStrength, 0, "环境归因后不动喷量校准");
});

test("嗅觉适应归因：连着穿同一瓶时的「淡了」不得换算成加喷量", () => {
  // 依据【实证·中】：重复暴露于同一款气味会造成持续数周的、气味特异性的敏感度下降。
  // 若把这种"淡了"记成喷量不足，就形成正反馈：闻不到→多喷→适应更深→还是闻不到，
  // 而周围人闻到的浓度一路上升。这是引擎里唯一一处会主动放大自身错误的回路。
  const now = Date.now();
  const plain = aggregateBias([fb({ rating: "too_weak", at: now })], now).get(1)!;
  const adapted = aggregateBias(
    [fb({ rating: "too_weak", at: now, tags: ["adaptation_attributed"] })],
    now
  ).get(1)!;
  assert.ok(plain.perceivedStrength < 0, "普通的「淡了」仍应记为偏淡");
  assert.equal(adapted.perceivedStrength, 0, "适应归因后不动喷量校准");
});

test("aggregateBias：负向信号存在 + 按月衰减（偏好不再只增不减、锁死不动）", () => {
  const now = Date.now();
  const MONTH = 30 * 24 * 3600 * 1000;
  const neg = aggregateBias([fb({ rating: "too_strong", at: now })], now).get(1)!;
  assert.ok(neg.likeScore < 0, "「太冲」应带轻微负向偏好");
  const freshLike = aggregateBias([fb({ rating: "perfect", at: now })], now).get(1)!.likeScore;
  const staleLike = aggregateBias([fb({ rating: "perfect", at: now - 6 * MONTH })], now).get(1)!.likeScore;
  assert.ok(staleLike < freshLike, "半年前的「刚好」话语权应低于昨天的");
});

test("aggregateBias + computeUsage：「刚好」沉淀成功配置，同温度档×同场合直接复用并给出说明", () => {
  const now = Date.now();
  const bias = aggregateBias(
    [fb({ rating: "perfect", at: now, sprays: [2, 3] })],
    now
  ).get(1)!;
  assert.ok(bias.successConfigs && bias.successConfigs.length === 1);
  const u = computeUsage(mk({ sillage: 1.8, sillageTier: 2 }), C({ occasion: "work", feel: "mild", tempC: 20 }), bias);
  assert.deepEqual(u.sprays, [3, 3], "复用上次「刚好」的中值（round(2.5)=3）");
  assert.ok(u.note, "校准必须被感知");
  // 不同场合不复用
  const u2 = computeUsage(mk({ sillage: 1.8, sillageTier: 2 }), C({ occasion: "date", feel: "mild", tempC: 20 }), bias);
  assert.equal(u2.note, undefined);
});

test("aggregateBias + score：「不合场合」按场合降权，别的场合不受牵连", () => {
  const now = Date.now();
  const bias = aggregateBias([fb({ rating: "scene_mismatch", at: now })], now).get(1)!;
  const p = mk({ rating: null, accords: acc([["citrus", 60]]) });
  const atWork = score(p, C({ occasion: "work", feel: "mild", tempC: 20 }), bias).total;
  const plain = score(p, C({ occasion: "work", feel: "mild", tempC: 20 })).total;
  assert.ok(atWork < plain, "被点名不搭的场合应降权");
  const atHome = score(p, C({ occasion: "home", feel: "mild", tempC: 20 }), bias).total;
  const plainHome = score(p, C({ occasion: "home", feel: "mild", tempC: 20 }), { likeScore: bias.likeScore, perceivedStrength: 0 }).total;
  assert.ok(Math.abs(atHome - plainHome) < 1e-9, "其他场合只受 like 影响，不受场合惩罚");
});

test("数字白名单：事实里没给过的数字（如编造的 6.2）必须被拦下", () => {
  const facts = `今天上海 33℃ 湿度 78%，建议喷 2 下`;
  const allowed = extractDigits(facts);
  assert.deepEqual(findInventedNumbers("今天 33℃，喷 2 下，留香约 6.2 小时", allowed), ["6.2"]);
  assert.deepEqual(findInventedNumbers("湿度 78%，2 下就好", allowed), []);
  assert.deepEqual(findInventedNumbers("大概 3 小时后补一次", allowed), ["3"]);
});

test("餐桌场合：浓香/甜香收敛并给出风险提示（meal 开关）", () => {
  const sweetLoud = mk({ sillage: 3.5, sillageTier: 4, accords: acc([["sweet", 70]]) });
  const ctx = C({ occasion: "date", feel: "mild", tempC: 20, meal: true });
  const risks = computeRisks(sweetLoud, ctx);
  assert.ok(risks.some((r) => r.includes("食物")), "应有餐桌风险提示");
  const withMeal = computeUsage(sweetLoud, ctx);
  const noMeal = computeUsage(sweetLoud, C({ occasion: "date", feel: "mild", tempC: 20 }));
  assert.ok(withMeal.sprays[1] <= noMeal.sprays[1]);
});

test("「用力过猛」组合：甜重/浓白花 × 强扩散 × 通勤，压喷量、放低位置、给提示", () => {
  const loudSweet = mk({ sillage: 2.8, sillageTier: 3, accords: acc([["sweet", 60], ["white floral", 55]]) });
  const ctx = C({ occasion: "commute", feel: "mild", tempC: 20 });
  const u = computeUsage(loudSweet, ctx);
  assert.ok(u.sprays[1] <= 2, `喷量应压到最低档，得 ${u.spraysLabel}`);
  assert.ok(u.placement.some((x) => x.includes("腰") || x.includes("下摆")), "位置应放低");
  assert.ok(computeRisks(loudSweet, ctx).some((r) => r.includes("用力过猛")));
});

test("rankSearchHits：统一榜单——文本档位优先，同档位内按主流度；不分区不折叠", async () => {
  const { rankSearchHits } = await import("./perfumes");
  const C = (item: string, nameHay: string, fullHay: string, people: number) => ({ item, nameHay, fullHay, people });
  // 「观夏」回归：品牌命中（档位2）必须排在主目录的单字垃圾命中（档位1）之前，
  // 哪怕垃圾命中的投票人数高得多——高度匹配不许被热门度淹没
  const merged = rankSearchHits("观夏", [
    C("junk-popular", "诺亚", "诺亚 Nobody", 99999),
    C("gx-tea", "Triple Tea 三重茶", "Triple Tea 三重茶 To Summer | 观夏", 261),
    C("gx-snow", "Cedarwood 昆仑煮雪", "Cedarwood 昆仑煮雪 To Summer | 观夏", 80),
  ]);
  assert.deepEqual(merged, ["gx-tea", "gx-snow", "junk-popular"]);
  // 名称直接命中（档位3）压过品牌命中（档位2）
  const t3 = rankSearchHits("昆仑煮雪", [
    C("brand-only", "别的", "别的 昆仑煮雪牌", 5000),
    C("name-hit", "Cedarwood 昆仑煮雪", "Cedarwood 昆仑煮雪 To Summer | 观夏", 80),
  ]);
  assert.equal(t3[0], "name-hit");
  // 同名多版本：同档位内更主流（投票更多）的版本在前
  const versions = rankSearchHits("大地", [
    C("flanker", "大地 限量版", "大地 限量版 Hermès", 800),
    C("mainline", "大地", "大地 Hermès 爱马仕", 26000),
  ]);
  assert.deepEqual(versions, ["mainline", "flanker"]);
  // 全无子串命中（拼写误差）→ 档位1 内按主流度，仍然给结果、不留空
  const fuzzy = rankSearchHits("sumer", [C("a", "Summer Hit", "Summer Hit X", 10), C("b", "Another", "Another Y", 500)]);
  assert.deepEqual(fuzzy, ["b", "a"]);
});

test("天气归因：冷天暖调不得被说成「清爽通透」——归因由 tone 决定，不由 W 数值反推(P0-3)", () => {
  // 2℃ 的烟草香草：weatherFit 给 ×1.15 加成。旧代码只看 W>=1.08 就写「清爽通透」，
  // 而这句是 reasons[0]，会作为"事实"送进 /api/explain 让 LLM 忠实复述。
  const warmHeavy = mk({ people: 20000, accords: acc([["vanilla", 70], ["tobacco", 60], ["amber", 55]]) });
  const cold = C({ feel: "cold", tempC: 2, occasion: "casual", season: "winter" });
  const wf = weatherFit(warmHeavy, "cold", 2);
  assert.ok(wf.w > 1.08, "确实拿到了加成");
  assert.equal(wf.tone, "warm_in_cold");
  const reasons = buildPick(warmHeavy, cold).reasons;
  assert.ok(!reasons.some((r) => r.includes("清爽")), `冷天暖调不该说清爽：${JSON.stringify(reasons)}`);
  assert.ok(reasons.some((r) => r.includes("暖意")), `应说暖意立得住：${JSON.stringify(reasons)}`);
  // 反向：湿热天的清冽调才配"清爽通透"
  const freshP = mk({ people: 20000, accords: acc([["citrus", 70]]) });
  assert.equal(weatherFit(freshP, "hot_humid").tone, "fresh_in_heat");
  assert.ok(buildPick(freshP, C({ feel: "hot_humid", tempC: 32 })).reasons.some((r) => r.includes("清爽")));
});

test("不许编造社区数据：无社区数据的香绝不出现「社区投票里…」(P0-4)", () => {
  const custom = mk({ id: -1, custom: true, people: 0, rating: null });
  const ctx = C({ season: "summer", feel: "mild", tempC: 20, occasion: "casual" });
  const reasons = buildPick(custom, ctx).reasons;
  assert.ok(!reasons.some((r) => r.includes("社区投票")), `手动记录的香不该提社区投票：${JSON.stringify(reasons)}`);
  // 低票扩展集同样不许
  const low = mk({ id: 9, lowVotes: true, people: 12, seasonPct: { winter: 0.05, spring: 0.05, summer: 0.8, autumn: 0.1 } });
  assert.ok(!buildPick(low, ctx).reasons.some((r) => r.includes("社区投票")));
  // 票数充足的才有资格说
  const solid = mk({ id: 10, people: 20000, seasonPct: { winter: 0.05, spring: 0.05, summer: 0.8, autumn: 0.1 } });
  assert.ok(buildPick(solid, ctx).reasons.some((r) => r.includes("社区投票")));
});

test("主推位一票否决：被自己判 avoid 的瓶子不得因轮换因子浮上来当主推(P0-5)", () => {
  // 两瓶库（新用户的典型状态）：#1 今天合适但昨天喷过（freshness≈0.58 的 -42% 降权），
  // #2 今天被判 avoid。旧代码按排名分取 ranked[0]，主推卡右上角会挂着「今天不建议」。
  const good = mk({ id: 1, people: 20000, sillageTier: 2, accords: acc([["citrus", 60]]) });
  const bad = mk({ id: 2, people: 20000, sillageTier: 4, accords: acc([["citrus", 60]]) }); // tier4×封闭场合 → avoid
  const ctx = C({ occasion: "work", feel: "mild", tempC: 20 });
  const now = new Date(2026, 6, 8, 9, 0).getTime();
  const { primary, ranked } = recommend([good, bad], ctx, undefined, {
    lastWornAt: new Map([[1, now - 24 * 3600 * 1000]]),
    now,
    daySeed: 1,
  });
  assert.equal(ranked.find((r) => r.perfume.id === 2)!.verdict, "avoid", "前提：#2 确实被判 avoid");
  assert.notEqual(primary!.verdict, "avoid", "主推不得是 avoid");
  assert.equal(primary!.perfume.id, 1);
});

test("成功配置不得越过安全阀：「上次刚好」覆盖不了今天更收着的场合(P0-1)", () => {
  // 「用力过猛」组合（甜重×强扩散×通勤）规则会把喷量压到 1 下。
  // 旧代码把 successConfig 放在所有安全阀之后无条件覆盖 → 压回 4 下。
  const loudSweet = mk({ sillage: 2.8, sillageTier: 3, accords: acc([["sweet", 60], ["white floral", 55]]) });
  const ctx = C({ occasion: "commute", feel: "mild", tempC: 20 });
  const bias = {
    likeScore: 0,
    perceivedStrength: 0,
    successConfigs: [{ occasion: "commute" as const, tempBand: "mild" as const, sprays: 4 }],
  };
  const u = computeUsage(loudSweet, ctx, bias);
  assert.ok(u.sprays[1] <= 1, `安全阀必须赢：得 ${u.spraysLabel}`);
  assert.ok(u.note?.includes("更收着"), "被压低时要说明白为什么，不能默默改数");
});

test("成功配置是基准不是终点：更近的反馈与场景必须还能推动它", () => {
  // 它此前写在偏好**之后**、且是无条件覆盖，于是只夹住了安全阀：
  // 一条旧的「刚好 4 下」会盖过随后两次「太冲了」，也盖过场景解析出的「今晚想贴身」。
  // 反馈闭环是这个产品唯一的真壁垒，让最新的反馈失效比不做这个功能更糟。
  const p = mk({ people: 2000, sillage: 2.5, sillageTier: 2, accords: acc([["woody", 80]]) });
  const cfg = { occasion: "home" as const, tempBand: "mild" as const, sprays: 4 };
  const at = (bias: Parameters<typeof computeUsage>[2], patch: Partial<Context> = {}) =>
    computeUsage(p, C({ occasion: "home", feel: "mild", tempC: 20, ...patch }), bias);

  const base = at({ likeScore: 0.5, perceivedStrength: 0, successConfigs: [cfg] });
  const afterTooStrong = at({ likeScore: 0.2, perceivedStrength: 0.8, successConfigs: [cfg] });
  const wantClose = at({ likeScore: 0.5, perceivedStrength: 0, successConfigs: [cfg] }, { intimacy: "close" });

  assert.ok(afterTooStrong.sprays[1] < base.sprays[1], `两次「太冲了」之后必须更少：${afterTooStrong.spraysLabel}`);
  assert.ok(wantClose.sprays[1] < base.sprays[1], `场景说「想贴身」也要能推动它：${wantClose.spraysLabel}`);
  // 回执必须跟着最终这个数走，不能停在「就按那次的量来」
  assert.ok(afterTooStrong.note?.includes("偏冲"), `回执要说清为什么比记忆里更少：${afterTooStrong.note}`);
});

test("场景张力真的进引擎：tension=high 压强扩散、收喷量、给提示(P0-7)", () => {
  const loud = mk({ people: 20000, sillage: 2.8, sillageTier: 3, accords: acc([["sweet", 60]]) });
  const base = C({ occasion: "social", feel: "mild", tempC: 20 });
  const tense = C({ occasion: "social", feel: "mild", tempC: 20, tension: "high" });
  assert.ok(score(loud, tense).total < score(loud, base).total, "高张力应降权强扩散甜香");
  assert.ok(computeUsage(loud, tense).sprays[1] < computeUsage(loud, base).sprays[1], "高张力应再收一档");
  assert.ok(computeRisks(loud, tense).some((r) => r.includes("成为被讨论")), "应给出社交提示");
  // formality 同样必须被消费（自由文本说"很正式"时，哪怕 occasion 落在 social 也要收得住）
  const formal = C({ occasion: "social", feel: "mild", tempC: 20, formality: 0.85 });
  assert.ok(score(loud, formal).total < score(loud, base).total, "高正式度应降权甜香强扩散");
});

test("无幽灵香调键：引擎引用的每个 accord 都必须在真实数据集里存在", async () => {
  // 曾经的实际情况：scoring.ts 引用 resinous / sandalwood / cedar / watery / jasmine / 裸 spicy，
  // 而数据集里这些键出现 0 次——规则静默空转，谁也不会发现。
  // 代价最大的是 resinous：数据集里这个家族其实叫 balsamic（208 款），
  // 于是 208 款树脂香膏调在热天不算厚重、在冷天也不算暖调，两条规则都白写。
  const fs = await import("node:fs");
  const { ENGINE_ACCORD_KEYS } = await import("./scoring");
  const real = new Set<string>();
  const catalog = JSON.parse(fs.readFileSync("public/data/perfumes.min.json", "utf8")) as Perfume[];
  for (const p of catalog) for (const a of p.accords) real.add(a.en);
  const ghosts = ENGINE_ACCORD_KEYS.filter((k) => !real.has(k));
  assert.deepEqual(ghosts, [], `引擎引用了数据集里不存在的香调键：${ghosts.join(", ")}`);
});

test("构建产物里不得出现 0 分：0 是「没有票」的哨兵，不是评分", async () => {
  // rating/longevity/priceValue 量表是 1..5，sillage 是 1..4（ledecanteur/SCHEMA.md）——
  // 0 在任何一个量表上都超出下界。而 `d?.longevity?.average ?? null` 只兜 null/undefined，
  // 0 会原样通过，于是零票记录被当成"留香 0 分"这个真实档位继续往下走：
  //   durationHint(0) → 「散得偏快…」；sillageTier(0) → 1 档「贴身可闻 · 密闭也安全」。
  // 修复前实测：扩展集 458 条 longevity=0、444 条 sillage=0、252 条 rating=0，且高度集中在国货。
  const fs = await import("node:fs");
  const bad: string[] = [];
  const check = (list: Perfume[], where: string) => {
    for (const p of list) {
      for (const k of ["rating", "longevity", "sillage", "priceValue"] as const) {
        if (p[k] === 0) bad.push(`${where} id=${p.id} ${k}=0`);
      }
    }
  };
  check(JSON.parse(fs.readFileSync("public/data/perfumes.min.json", "utf8")), "主目录");
  for (const f of fs.readdirSync("public/data/ext")) {
    if (!f.endsWith(".json")) continue;
    check(JSON.parse(fs.readFileSync(`public/data/ext/${f}`, "utf8")), `ext/${f}`);
  }
  assert.deepEqual(bad.slice(0, 5), [], `构建产物里仍有 0 分（共 ${bad.length} 处）`);
});

// 结构性不变式：判了「今天不建议」，就必须说得出为什么。
// 这条断言的价值不在于守住已知的那个洞（反季裁决漏了票数门槛），而在于**堵住整类**——
// 将来任何人新加一条 avoid 分支，只要忘了配套的风险文案，这里就会红。
// 修复前实测：扩展集 35990 条里有 3874 条正处在"判了却说不出为什么"的状态。
test("判了「今天不建议」就必须说得出为什么：全量数据上 avoid ⇒ risks 非空", async () => {
  const fs = await import("node:fs");
  // 三组情境覆盖四条 avoid 触发：反季（夏/冬各一次）、封闭场合（tier4）、高温（热负荷饱和）
  const contexts = [
    C({ occasion: "commute", feel: "hot_dry", tempC: 32, humidity: 45, season: "summer" }),
    C({ occasion: "formal", feel: "cold", tempC: 3, humidity: 55, season: "winter" }),
    // 35℃：热负荷饱和，avoidCause="weather" 这条通道真正被走到的那一档
    C({ occasion: "casual", feel: "hot_dry", tempC: 35, humidity: 40, season: "summer" }),
  ];
  const bad: string[] = [];
  const scan = (list: Perfume[], where: string) => {
    for (const p of list) {
      for (const ctx of contexts) {
        const pick = buildPick(p, ctx);
        if (pick.verdict !== "avoid") continue;
        if (pick.risks.length === 0)
          bad.push(`${where} id=${p.id} ${p.nameZh || p.name} ${ctx.season} 判 avoid 却零风险说明`);
        if (pick.avoidCause === null) bad.push(`${where} id=${p.id} avoid 却没有成因`);
      }
    }
  };
  scan(JSON.parse(fs.readFileSync("public/data/perfumes.min.json", "utf8")), "主目录");
  for (const f of fs.readdirSync("public/data/ext")) {
    if (!f.endsWith(".json")) continue;
    scan(JSON.parse(fs.readFileSync(`public/data/ext/${f}`, "utf8")), `ext/${f}`);
  }
  assert.deepEqual(bad.slice(0, 5), [], `仍有"判了说不出为什么"的记录（共 ${bad.length} 条）`);
});

test("avoid 的成因随裁决一起带出来，且与触发条件对得上", () => {
  // 归因必须在算的那一刻带出来——数值说得出"扣了分"，说不出"因为什么扣分"。
  // 下游（发现型钩子的眉标）只认这个字段；它错了，20℃ 多云的一天就会弹「天气突变」。
  const winterOnly = mk({
    people: 20000, sillageTier: 2,
    seasonPct: { winter: 0.6, spring: 0.15, summer: 0.1, autumn: 0.15 },
    accords: acc([["vanilla", 100], ["sweet", 80]]),
  });
  const s = buildPick(winterOnly, C({ occasion: "casual", feel: "mild", tempC: 24, season: "summer" }));
  assert.equal(s.verdict, "avoid");
  assert.equal(s.avoidCause, "season");

  // tier4 遇封闭场合 → 场地成因（用四季均衡的香，排除反季干扰）
  const loud = mk({
    people: 20000, sillageTier: 4,
    seasonPct: { winter: 0.25, spring: 0.25, summer: 0.25, autumn: 0.25 },
    accords: acc([["citrus", 100], ["fresh", 60]]),
  });
  const v = buildPick(loud, C({ occasion: "work", feel: "mild", tempC: 20, season: "spring" }));
  assert.equal(v.verdict, "avoid");
  assert.equal(v.avoidCause, "venue");

  // 无香场合 → 单独一档，钩子据此整张卡不弹
  const ff = buildPick(loud, C({ occasion: "work", feel: "mild", tempC: 20, season: "spring", fragranceFree: true }));
  assert.equal(ff.avoidCause, "fragrance_free");

  // 非 avoid 一律为 null，不许留下上一次的残值
  const ok = buildPick(loud, C({ occasion: "casual", feel: "mild", tempC: 20, season: "spring" }));
  assert.notEqual(ok.verdict, "avoid");
  assert.equal(ok.avoidCause, null);
});

test("「也可以考虑」不得出现产品自己反对的选项；全柜皆 avoid 时如实上报", () => {
  const summer = C({ occasion: "casual", feel: "hot_dry", tempC: 31, humidity: 45, season: "summer" });
  const fresh = mk({ id: 1, people: 20000, sillageTier: 2, accords: acc([["citrus", 100], ["fresh", 70]]) });
  const winterHeavy = (id: number) =>
    mk({
      id, people: 20000, sillageTier: 3,
      seasonPct: { winter: 0.6, spring: 0.15, summer: 0.1, autumn: 0.15 },
      accords: acc([["vanilla", 100], ["sweet", 85]]),
    });

  // 混合香柜：备选里一瓶 avoid 都不许有
  const mixed = recommend([fresh, winterHeavy(2), winterHeavy(3)], summer);
  assert.equal(mixed.allAvoid, false);
  assert.equal(mixed.primary!.perfume.id, 1);
  assert.deepEqual(
    mixed.alternatives.filter((a) => a.verdict === "avoid"),
    [],
    "「也可以考虑」里出现了引擎自己判 avoid 的瓶"
  );

  // 全柜皆 avoid：如实上报，且仍要给出"真要用就这么用"的那一瓶
  const allBad = recommend([winterHeavy(2), winterHeavy(3)], summer);
  assert.equal(allBad.allAvoid, true);
  assert.ok(allBad.primary, "全柜不合适时仍要给出相对最稳的一瓶");
  assert.equal(allBad.primary!.verdict, "avoid");
  assert.ok(allBad.alternatives.length > 0, "全柜皆 avoid 时不该把备选滤空，让人自己挑");
});

test("无社区数据的香：留香话术必须落「因人而异」，且不许谎称社区投票", () => {
  // 零票记录（多为国货）此前会被告知"散得偏快"与"贴身可闻·密闭也安全"——后者还是安全断言。
  const noData = mk({ id: 99, lowVotes: true, people: 1, rating: null, longevity: null, sillage: null, sillageTier: 2 });
  const pick = buildPick(noData, C({ occasion: "work", feel: "mild", tempC: 20 }));
  assert.ok(pick.usage.durationHint.includes("因人而异"), `应落"不知道"话术：${pick.usage.durationHint}`);
  assert.ok(pick.reasons.some((r) => r.includes("社区数据还少")), "应主动声明数据少");
  assert.ok(!pick.reasons.some((r) => r.includes("社区投票")), "不得谎称社区投票");
});

test("一族要主导这瓶才算这瓶的气质：清爽香的甜尾/干琥珀不得被判厚重、不得提示留印", () => {
  // accord 的 strength 是相对**这一瓶自身轮廓**的排位强度，不是绝对浓度。
  // 用绝对阈值判整瓶气质，会让「第五位的一点甜尾」和「vanilla=100 的主体」拿到同一句话。
  // 这一条锁的是 familyDominance 这道比例判据，和「琥珀不是甜」是同一类错误的下一层：
  // 上一层修的是"哪些键属于哪一族"，这一层修的是"某族要占到多重才配代表这瓶"。
  const hot = C({ occasion: "casual", feel: "hot_dry", tempC: 31, humidity: 50, season: "summer" });

  // 蓝风铃真实数据：粉感 100 / 麝香 98 / 绿叶 95 / 水生 82 / 甜 54 —— tier1 的通勤香
  const bluebell = mk({
    people: 5484, sillageTier: 1,
    accords: acc([["powdery", 100], ["musky", 98], ["green", 95], ["aquatic", 82], ["sweet", 54]]),
  });
  // 旷野真实数据：清新辛香 100 / 琥珀 59（Ambroxan 干琥珀）/ 柑橘 56
  const sauvage = mk({
    people: 32551, sillageTier: 3,
    accords: acc([["fresh spicy", 100], ["amber", 59], ["citrus", 56], ["aromatic", 48]]),
  });
  // 烟草香草真实数据：香草 100 / 甜 92 / 烟草 79 —— 真的厚重，必须仍被抓住
  const tobaccoV = mk({
    people: 30312, sillageTier: 3,
    accords: acc([["vanilla", 100], ["sweet", 92], ["tobacco", 79], ["warm spicy", 60]]),
  });

  for (const [name, p] of [["蓝风铃", bluebell], ["旷野", sauvage]] as const) {
    const pk = buildPick(p, hot);
    assert.ok(
      !pk.reasons.some((r) => r.includes("偏厚重")),
      `${name} 不该被判厚重：${JSON.stringify(pk.reasons)}`
    );
    assert.ok(
      !pk.risks.some((r) => r.includes("留印")),
      `${name} 不该提示留印：${JSON.stringify(pk.risks)}`
    );
  }
  // 反例守住：真正甜厚的香照旧要被判厚重
  const heavy = buildPick(tobaccoV, hot);
  assert.ok(
    heavy.reasons.some((r) => r.includes("偏厚重")),
    `真甜厚的香必须仍被判厚重：${JSON.stringify(heavy.reasons)}`
  );
  assert.ok(familyDominance(tobaccoV, ["sweet", "vanilla"]) >= DOMINANT);
  assert.ok(familyDominance(bluebell, ["sweet", "vanilla"]) < DOMINANT);
  assert.ok(familyDominance(sauvage, ["amber", "balsamic"]) < DOMINANT);
});

test("「天气突变预警」的天气成因必须在真实气象下够得到", async () => {
  // 旧判据 `parts.weather <= 0.82` 落在曲线最后一个百分点里（下界就是 0.81），
  // 实测要求露点 ≥32℃——中国最高露点纪录 29℃ 上下，也就是说这条成因在真实天气下
  // 基本是死代码：为它专门写的眉标「今天的体感」与那句兜底几乎永不渲染，
  // 旗舰钩子的名字底下用户只看得到 season 与 venue 两种成因。34.0℃ 那一点的结论
  // 还由浮点尾数决定。现在改成落在有语义的量上：厚重族主导 + 热负荷接近饱和。
  const tobaccoV = mk({
    people: 30312, sillageTier: 3,
    seasonPct: { winter: 0.3, spring: 0.2, summer: 0.2, autumn: 0.3 }, // 不触发反季，隔离出天气这条
    accords: acc([["vanilla", 100], ["sweet", 92], ["tobacco", 79]]),
  });
  // 34℃ 干热、湿度 40%——一个北方盛夏的寻常读数，没有任何极端假设
  const veryHot = C({ occasion: "casual", feel: "hot_dry", tempC: 34, humidity: 40, season: "summer" });
  const pk = buildPick(tobaccoV, veryHot);
  assert.equal(pk.verdict, "avoid", "34℃ 的厚重香必须够得到 avoid");
  assert.equal(pk.avoidCause, "weather");
  assert.ok(pk.avoidRisk, `天气成因必须说得出对应的那一条：${JSON.stringify(pk.risks)}`);
  // 30℃ 还没到那一档：不能一热就劝退
  const warm = C({ occasion: "casual", feel: "hot_dry", tempC: 30, humidity: 40, season: "summer" });
  assert.notEqual(buildPick(tobaccoV, warm).verdict, "avoid", "30℃ 不该判 avoid");
  // 清爽香在同样的 34℃ 下不受影响
  const fresh = mk({ people: 20000, accords: acc([["citrus", 100], ["aquatic", 70]]) });
  assert.notEqual(buildPick(fresh, veryHot).avoidCause, "weather");

  // 烟草/动物性主导的香：打分层算它厚重，风险文案层此前只认甜与树脂，
  // 于是会出现"判了却说不出为什么"。第三支必须接住。
  const tobaccoOnly = mk({ people: 20000, accords: acc([["tobacco", 100], ["leather", 80]]) });
  const risks = computeRisks(tobaccoOnly, veryHot);
  assert.ok(risks.some((r) => r.includes("厚重感")), `烟草主导也要说得出话：${JSON.stringify(risks)}`);
});

test("眉标说什么，正文就得说什么：avoidRisk 与 avoidCause 同源", async () => {
  // 预警卡的眉标按 avoidCause 分岔（「季节不对」/「今天的体感」/「场合偏封闭」），
  // 正文却一直取 risks[0]，而 risks 的追加顺序与成因优先级毫无关系。
  // 只要同时命中一条更靠前的风险，两句就说的不是同一件事——而这张卡印在 README 首屏图上。
  const { computeRiskNotes } = await import("./usage");

  // 冬香在夏天通勤：同时命中「高温甜」（risks[0]）与「反季」（真正的成因）
  const tobaccoV = mk({
    people: 30312, sillageTier: 3,
    seasonPct: { winter: 0.55, spring: 0.15, summer: 0.08, autumn: 0.22 },
    accords: acc([["vanilla", 100], ["sweet", 92], ["tobacco", 79]]),
  });
  const summerCommute = C({ occasion: "commute", feel: "hot_dry", tempC: 31, humidity: 45, season: "summer" });
  const pick = buildPick(tobaccoV, summerCommute);
  assert.equal(pick.verdict, "avoid");
  assert.equal(pick.avoidCause, "season");
  assert.ok(pick.risks[0].includes("甜感偏重"), "前提不成立：risks[0] 本该是那条高温风险");
  assert.ok(pick.avoidRisk?.includes("反季"), `正文必须跟着成因走：${pick.avoidRisk}`);
  assert.notEqual(pick.avoidRisk, pick.risks[0], "正文取 risks[0] 就是这次要修的那个错");

  // 全目录不变式：avoidRisk 只能是成因对应的那一条，不许是别的
  const fs = await import("node:fs");
  const catalog = JSON.parse(fs.readFileSync("public/data/perfumes.min.json", "utf8")) as Perfume[];
  const contexts = [
    summerCommute,
    C({ occasion: "formal", feel: "cold", tempC: 3, humidity: 55, season: "winter" }),
  ];
  let mismatched = 0;
  for (const p of catalog) {
    for (const ctx of contexts) {
      const pk = buildPick(p, ctx);
      if (pk.verdict !== "avoid" || pk.avoidCause === null || pk.avoidCause === "fragrance_free") {
        assert.equal(pk.avoidRisk, null, "非 avoid 不该带 avoidRisk");
        continue;
      }
      const expected = computeRiskNotes(p, ctx).find((n) => n.kind === pk.avoidCause)?.text ?? null;
      if (pk.avoidRisk !== expected) mismatched++;
    }
  }
  assert.equal(mismatched, 0, `avoidRisk 与成因脱节 ${mismatched} 处`);
});

test("「下次帮你略微多喷一点」必须真的多喷：安全阀没压过时偏好可升", () => {
  // 上一版把 safetyCap 取在偏好之前、又在偏好之后无条件钳制回去，
  // 等价于 `hi = Math.min(hi, 偏好之前的 hi)`——两条 +1 全是死代码。
  // 于是反馈条明写「记下了，下次帮你略微多喷一点」而引擎永远不会多喷，
  // 场景解析出的 intimacy="broadcast" 也不改变任何一个数字。
  const gentle = mk({ people: 20000, sillage: 2.0, sillageTier: 2 });
  const relaxed = C({ occasion: "home", feel: "mild", tempC: 20 });
  const base = computeUsage(gentle, relaxed).sprays[1];

  // ① 历史反馈「太淡了」→ 上限抬一档
  const weaker = computeUsage(gentle, relaxed, { likeScore: 0, perceivedStrength: -1 });
  assert.ok(weaker.sprays[1] > base, `说了会多喷就得真的多喷：${base} → ${weaker.sprays[1]}`);
  // ② 场景说「想被注意到」→ 同样抬一档
  const loud = computeUsage(gentle, { ...relaxed, intimacy: "broadcast" });
  assert.ok(loud.sprays[1] > base, `broadcast 必须改变数字：${base} → ${loud.sprays[1]}`);
  // ③ 两者叠加也只抬一档——与「天气驱动的减量总计封顶 1 下」同一条纪律
  const both = computeUsage(gentle, { ...relaxed, intimacy: "broadcast" }, { likeScore: 0, perceivedStrength: -1 });
  assert.equal(both.sprays[1], weaker.sprays[1], "两条偏好叠加不得抬成两档");
  // ④ 反方向仍要生效
  assert.ok(computeUsage(gentle, relaxed, { likeScore: 0, perceivedStrength: 1 }).sprays[1] < base);

  // ⑤ 安全阀压过的场合，偏好一步都不许抬（A 类不容 B 类覆盖）
  const closed = C({ occasion: "work", feel: "mild", tempC: 20 });
  const closedBase = computeUsage(gentle, closed).sprays[1];
  const closedLoud = computeUsage(gentle, { ...closed, intimacy: "broadcast" }, { likeScore: 0, perceivedStrength: -1 });
  assert.equal(closedLoud.sprays[1], closedBase, "封闭场合压过之后，偏好不得把闸门顶开");
});

test("厚重只准有一条判据：喷量、风险文案与打分归因不得各说各的", async () => {
  // 修复前的实际状态：打分层（scoring.ts）早就换成了主导度判据，而用户真正读到的那两处
  // ——computeRisks 的风险文案与 computeUsage 的高温减量——还留在绝对阈值 55 上。
  // 于是同一张卡先夸"调性清爽通透"，再罚"树脂琥珀感偏厚"，喷量还跟着少一下。
  // 主目录实测 111 款卡片自相矛盾、226 款拿到与分数相反的断言，其中包括旷野、信仰之水、
  // 探索家、邂逅柔情这些公认的清爽香。这条测试锁的不是某一款香，是"同一个概念只准有一处判据"。
  const fs = await import("node:fs");
  const { sweetDominates, balsamicDominates, richDominates, heavyDominates } = await import("./scoring");
  const catalog = JSON.parse(fs.readFileSync("public/data/perfumes.min.json", "utf8")) as Perfume[];
  const hot = C({ occasion: "casual", feel: "hot_dry", tempC: 33, humidity: 45, season: "summer" });
  // 三支都要数进来。此前这个谓词只认前两支，于是「厚重感在高温里会放大」那一支
  // ——烟草与动物性主导的那批——在断言里根本不存在，而减量恰恰就漏在它身上。
  const HEAVY_LINE = (s: string) =>
    s.includes("甜感偏重") || s.includes("树脂琥珀感偏厚") || s.includes("厚重感在高温里会放大");

  const contradictory: string[] = [];
  const mismatched: string[] = [];
  for (const p of catalog) {
    const pick = buildPick(p, hot);
    // ① 同一张卡不许既说清爽又说厚/腻
    if (pick.reasons.some((r) => r.includes("清爽通透")) && pick.risks.some(HEAVY_LINE))
      contradictory.push(`${p.nameZh || p.name}`);
    // ② 风险文案必须与高温减量走**同一个符号**：两边现在都是 heavyDominates(50)
    if (pick.risks.some(HEAVY_LINE) !== heavyDominates(p, 50)) mismatched.push(`${p.nameZh || p.name}`);
    // ③ 两族互斥且穷尽：并集的最大值必落在其中一族里
    assert.equal(richDominates(p, 55), sweetDominates(p, 55) || balsamicDominates(p, 55));
  }
  assert.deepEqual(contradictory.slice(0, 5), [], `卡片自相矛盾（共 ${contradictory.length} 款）`);
  assert.deepEqual(mismatched.slice(0, 5), [], `文案与减量判据脱节（共 ${mismatched.length} 款）`);

  // ④ 说了「收着些」，数字就得真的收——烟草主导的那一类正是此前只说不做的那批
  const mild = C({ occasion: "casual", feel: "mild", tempC: 20, humidity: 50, season: "autumn" });
  const tobaccoLed = mk({ people: 20000, sillage: 2.0, sillageTier: 2, accords: acc([["tobacco", 100], ["leather", 62]]) });
  assert.ok(computeRisks(tobaccoLed, hot).some(HEAVY_LINE), "烟草主导在高温下必须说得出厚重");
  assert.ok(
    computeUsage(tobaccoLed, hot).sprays[1] < computeUsage(tobaccoLed, mild).sprays[1],
    "说了「喷得收着些更稳」，高温下的喷量上限就必须真的比温和天低"
  );

  // 具体回归：清爽当家的三款不许拿到厚重断言，真厚重的照旧要被抓住
  const clean: [string, [string, number][]][] = [
    ["旷野", [["fresh spicy", 100], ["amber", 59], ["citrus", 56]]],
    ["探索家", [["woody", 100], ["balsamic", 70], ["aromatic", 55]]],
    ["信仰之水", [["fruity", 100], ["sweet", 55], ["citrus", 52]]],
  ];
  for (const [name, accords] of clean) {
    const risks = computeRisks(mk({ people: 20000, accords: acc(accords) }), hot);
    assert.ok(!risks.some(HEAVY_LINE), `${name} 不该拿到厚重断言：${JSON.stringify(risks)}`);
  }
  const tobaccoV = mk({ people: 30312, accords: acc([["vanilla", 100], ["sweet", 92], ["tobacco", 79]]) });
  assert.ok(computeRisks(tobaccoV, hot).some((r) => r.includes("甜感偏重")), "真甜厚的必须仍被抓住");
});

test("琥珀不是甜：干性琥珀香不得被判「偏甜重、容易发腻」(P0-2)", () => {
  // 蔚蓝浓香精的真实数据：amber=86, sweet=0, vanilla=0
  const blue = mk({ people: 20000, sillageTier: 3, accords: acc([["amber", 86], ["woody", 60]]) });
  const humid = C({ occasion: "casual", feel: "hot_humid", tempC: 32, season: "summer" });
  const risks = computeRisks(blue, humid);
  assert.ok(!risks.some((r) => r.includes("甜")), `不甜的香不该被说甜：${JSON.stringify(risks)}`);
  assert.ok(risks.some((r) => r.includes("树脂琥珀感偏厚")), `应给出树脂厚重的正确提示：${JSON.stringify(risks)}`);
  // 真甜的香照旧要被点名
  const gourmandP = mk({ people: 20000, accords: acc([["sweet", 70], ["vanilla", 60]]) });
  assert.ok(computeRisks(gourmandP, humid).some((r) => r.includes("发腻")));
  // 「别太甜」也不该误伤琥珀
  assert.equal(avoidPenalty(blue, ["too_sweet"]), 1, "琥珀不该被「别太甜」罚");
  assert.ok(avoidPenalty(gourmandP, ["too_sweet"]) < 1, "真甜的该被罚");
});

test("美食调邻居不算甜：cacao / coffee / almond 的干苦质感不得触发「发腻」", () => {
  // 这是 amber 错误的同类——修 amber 时若顺手把整个"美食调邻居"塞进甜桶，就会复刻它。
  // 数据取自本仓库真实目录，四款的核心甜调(sweet/vanilla/caramel/honey)全部 <30。
  const humid = C({ occasion: "casual", feel: "hot_humid", tempC: 32, season: "summer" });
  const cases: [string, [string, number][]][] = [
    ["迪奥桀骜", [["iris", 100], ["cacao", 68], ["powdery", 67], ["leather", 50]]],
    ["大写檀香", [["woody", 100], ["warm spicy", 77], ["cacao", 61]]],
    ["完美先生香精", [["almond", 100], ["leather", 74]]],
    ["万圣节男士X", [["warm spicy", 100], ["coffee", 59]]],
  ];
  for (const [name, accords] of cases) {
    const risks = computeRisks(mk({ people: 20000, accords: acc(accords) }), humid);
    assert.ok(!risks.some((r) => r.includes("甜感偏重")), `${name} 不该被判甜：${JSON.stringify(risks)}`);
  }
  // 而真正的美食甜香照旧命中
  assert.ok(
    computeRisks(mk({ people: 20000, accords: acc([["vanilla", 80], ["caramel", 60]]) }), humid).some((r) =>
      r.includes("甜感偏重")
    )
  );
});

test("balsamic 不再空转：树脂香膏调在热天算厚重、冷天算暖调", () => {
  const balsam = mk({ people: 20000, accords: acc([["balsamic", 70]]) });
  assert.ok(weatherMultiplier(balsam, "hot_humid") < 1, "湿热应压树脂香膏");
  assert.ok(weatherMultiplier(balsam, "cold") > 1, "寒冷应奖树脂香膏");
});

test("无香场合：就医/探病一律建议不用香，且任何个人偏好都覆盖不掉", () => {
  // 全引擎依据最好的一条规则（约 1/3 人群报告对香味制品不良反应，多国医疗机构有访客无香要求）。
  // format.ts 的 DISTANCE_HINT[1] 因此也不把"就医"列为贴肤香的适用场合——答案是"今天不用"。
  const gentle = mk({ people: 20000, sillage: 1.4, sillageTier: 1 });
  const ctx = C({ occasion: "casual", feel: "mild", tempC: 20, fragranceFree: true });
  // 连"上次这个量刚好"的成功配置也不能把它顶回去
  const bias = {
    likeScore: 1,
    perceivedStrength: -1,
    successConfigs: [{ occasion: "casual" as const, tempBand: "mild" as const, sprays: 4 }],
  };
  const u = computeUsage(gentle, ctx, bias);
  assert.deepEqual(u.sprays, [0, 0], `应建议 0 下，得 ${u.spraysLabel}`);
  assert.equal(u.spraysLabel, "今天不用");
  assert.deepEqual(u.placement, []);
  assert.equal(u.suitable, false);
  // 裁决：不是"这瓶不合适"，是今天哪瓶都不合适
  assert.equal(buildPick(gentle, ctx, bias).verdict, "avoid");
  // 风险只说这一条，不再堆别的
  const risks = computeRisks(gentle, ctx);
  assert.equal(risks.length, 1);
  assert.ok(risks[0].includes("留在家里"));
});

test("季节错配文案同样要过票数门槛：三票的噪声不得说「大家更多在◯季用它」", () => {
  // 这与 buildReasons 里那条「社区投票里它更偏◯季」是同一类编造，只是藏在风险文案里晚一步被发现。
  const peak = { winter: 0.75, spring: 0.1, summer: 0.05, autumn: 0.1 };
  const summer = C({ season: "summer", feel: "mild", tempC: 20, occasion: "casual" });
  const low = mk({ id: 7, lowVotes: true, people: 3, seasonPct: peak });
  assert.ok(
    !computeRisks(low, summer).some((r) => r.includes("大家更多在")),
    `三票不该说"大家更多在"：${JSON.stringify(computeRisks(low, summer))}`
  );
  const custom = mk({ id: -2, custom: true, people: 0, seasonPct: peak });
  assert.ok(!computeRisks(custom, summer).some((r) => r.includes("大家更多在")));
  // 票数充足的照旧提示反季
  const solid = mk({ id: 8, people: 20000, seasonPct: peak });
  assert.ok(computeRisks(solid, summer).some((r) => r.includes("大家更多在冬季")));
});

test("社交距离的归因也要过票数这道门：没票就不许署名「多数评价者的感受」", async () => {
  // 同一排三格里的对照此前很刺眼：「留香」诚实写「因人而异」，「社交距离」却拿一份
  // 从未存在过的投票给出「日常安全」——三格里唯一带安全含义的恰恰是这一格。
  // 实测扩展集 35990 条里 444 条 sillage 为 null（几乎全是国货白名单，people 常年个位数）。
  const { sillageAttrib, sillageSub, DISTANCE_ATTRIB } = await import("./format");

  const solid = mk({ people: 20000, sillage: 2.5, sillageTier: 2 });
  assert.equal(sillageAttrib(solid), DISTANCE_ATTRIB, "有票的照旧署名社区");
  assert.equal(sillageSub(solid, 2), "日常安全");

  // 手动记一瓶：那一档是用户在 ManualAdd 里自己勾的
  const custom = mk({ id: -3, custom: true, people: 0, sillage: 2.7, sillageTier: 2 });
  assert.ok(!sillageAttrib(custom).includes("评价者"), `手动记录不该署名社区：${sillageAttrib(custom)}`);
  assert.ok(!sillageSub(custom, 2).includes("安全"), `手动记录不该给安全断言：${sillageSub(custom, 2)}`);

  // 国货白名单：有记录但一票都没有，sillage 为 null 时 derive.mjs 统一落到 tier 2
  const thin = mk({ id: 9, lowVotes: true, people: 1, sillage: null as unknown as number, sillageTier: 2 });
  assert.ok(!sillageAttrib(thin).includes("评价者"), `零票不该署名社区：${sillageAttrib(thin)}`);
  assert.ok(!sillageSub(thin, 2).includes("安全"), `零票不该给安全断言：${sillageSub(thin, 2)}`);
});

test("安全阀不许被个人偏好顶开：说了「压到 1 下」就必须真的是 1 下", () => {
  // 原实现在个人偏好**之后**才取 safetyCap，于是偏好把闸抬起来之后，
  // 抬起来的那个值反过来成了"安全上限"。触发门槛极低：场景里写一句「想让人注意到」，
  // 或历史上按过两次「淡了点」，办公室浓甜白花的礼仪硬闸就被解除了。
  // 这一条把整个偏好空间都参数化扫一遍，堵住"换个偏好再来一次"。
  const tobaccoV = mk({
    people: 30312, sillageTier: 3,
    accords: acc([["vanilla", 100], ["sweet", 92], ["tobacco", 79], ["warm spicy", 60]]),
  });
  const base = C({ occasion: "commute", feel: "mild", tempC: 20, season: "spring" });
  assert.ok(
    computeRisks(tobaccoV, base).some((r) => r.includes("压到 1 下")),
    "前提不成立：这个组合本该触发「用力过猛」风险文案"
  );

  for (const ps of [-1, -0.7, -0.4, 0, 0.4, 1]) {
    for (const intimacy of ["close", "neutral", "broadcast"] as const) {
      for (const cfg of [undefined, [{ occasion: "commute" as const, tempBand: "mild" as const, sprays: 4 }]]) {
        const ctx = C({ occasion: "commute", feel: "mild", tempC: 20, season: "spring", intimacy });
        const u = computeUsage(tobaccoV, ctx, {
          likeScore: 0,
          perceivedStrength: ps,
          ...(cfg ? { successConfigs: cfg } : {}),
        } as never);
        assert.equal(
          u.spraysLabel,
          "1 下",
          `安全阀被顶开：ps=${ps} intimacy=${intimacy} successConfig=${!!cfg} → ${u.spraysLabel}`
        );
      }
    }
  }
});

test("说了「收着些」就得真的收：高温风险文案与喷量必须一致", () => {
  // 蔚蓝浓香精真实数据 sil=2.17 amber=86。此前高温减量只认 sillage≥3.2，
  // 于是 33℃ 下一边弹「高温里存在感会比你以为的更强，喷得收着些更稳」，
  // 一边给出 3–4 下的最高档——文案承诺了引擎没做的事。
  const blue = mk({ people: 20000, sillage: 2.17, sillageTier: 2, accords: acc([["citrus", 100], ["amber", 86]]) });
  const mild = computeUsage(blue, C({ occasion: "casual", feel: "mild", tempC: 20 }));
  const hot = computeUsage(blue, C({ occasion: "casual", feel: "hot_humid", tempC: 33, humidity: 78 }));
  assert.ok(computeRisks(blue, C({ occasion: "casual", feel: "hot_humid", tempC: 33 })).some((r) => r.includes("收着些")));
  assert.ok(hot.sprays[1] < mild.sprays[1], `说了收着就得收：mild=${mild.spraysLabel} hot=${hot.spraysLabel}`);
  // 天气驱动的减量封顶 1 下：又强扩散又厚重也只减一次
  const both = mk({ people: 20000, sillage: 3.5, sillageTier: 4, accords: acc([["amber", 80]]) });
  const bm = computeUsage(both, C({ occasion: "casual", feel: "mild", tempC: 20 }));
  const bh = computeUsage(both, C({ occasion: "casual", feel: "hot_humid", tempC: 33, humidity: 78 }));
  assert.equal(bm.sprays[1] - bh.sprays[1], 1, "两条同时命中也只减 1 下");
});

test("织物提示是提示不是风险：它不得把裁决从 good 降级成 caution", () => {
  // 封闭场合（通勤/上班/正式）的部位建议里必然出现"衣物内侧"，从而触发织物留印提示。
  // 若这条提示参与裁决（computeVerdict 的规则是 risks.length > 0 → caution），
  // 最常见的那几个场合就会被无端全部降级——这是提示与风险混为一谈的典型代价。
  // 用真正会留印的组分：有色的树脂香膏。
  // ⚠️ 这里**不能**再拿 amber 当正例（旧版就是这么写的，于是漏掉了整类干琥珀）——
  // amber 标签下混着劳丹脂+安息香的有色甜琥珀与 Ambroxan 的无色干琥珀，
  // 数据层分不开，留印这条按机制宁可漏报，见 scoring.ts:stainProneDominates。
  const work = C({ occasion: "work", feel: "mild", tempC: 20 });
  const resin = mk({ people: 20000, sillageTier: 2, sillage: 2.0, accords: acc([["balsamic", 80], ["woody", 60]]) });
  const pick = buildPick(resin, work);
  assert.ok(pick.usage.placement.some((x) => x.includes("衣物")), "前提：确实建议了喷衣物");
  assert.ok(pick.risks.some((r) => r.includes("留印子")), "前提：确实给了织物提示");
  assert.equal(pick.verdict, "good", "织物提示不该影响裁决");

  // 反向一：清爽柑橘同样建议喷衣物，但不该被这条噪音打扰
  const fresh = mk({ people: 20000, sillageTier: 2, sillage: 2.0, accords: acc([["citrus", 100]]) });
  const fp = buildPick(fresh, work);
  assert.ok(fp.usage.placement.some((x) => x.includes("衣物")), "前提：也建议了喷衣物");
  assert.ok(!fp.risks.some((r) => r.includes("留印子")), "柑橘不该触发留印提示");

  // 反向二：以 Ambroxan 干琥珀当骨架的清冽香（蔚蓝浓香精真实数据：citrus=100, amber=86, sweet=0）。
  // 它是这条判据此前漏网的那 26 款的代表——无色合成体，恰在"有色浸膏"这个机制之外。
  const dryAmber = mk({ people: 20000, sillageTier: 3, accords: acc([["citrus", 100], ["amber", 86], ["woody", 60]]) });
  const dp = buildPick(dryAmber, work);
  assert.ok(!dp.risks.some((r) => r.includes("留印子")), `干琥珀不该触发留印提示：${JSON.stringify(dp.risks)}`);
  // 而真正甜的香照旧要提示（香草醛与焦糖是实打实的油渍源）
  const gourmandP = mk({ people: 20000, sillageTier: 2, sillage: 2.0, accords: acc([["vanilla", 100], ["sweet", 80]]) });
  assert.ok(buildPick(gourmandP, work).risks.some((r) => r.includes("留印子")), "甜厚的香必须仍提示留印");
});

test("riskNote：场景解析的社交风险以受控字段进入风险列表", () => {
  const p = mk({ accords: acc([["citrus", 60]]) });
  const risks = computeRisks(p, C({ occasion: "formal", feel: "mild", tempC: 20, riskNote: "婚礼焦点是新人，不宜喧宾夺主" }));
  assert.ok(risks.some((r) => r.includes("喧宾夺主")));
});

test("不变式：判了 caution 就必须说得出为什么——扫遍温湿度 × 场合，不许有一例空清单", () => {
  // 裁决有两个触发源：risks 非空，以及天气压到 WEATHER_CAUTION 以下。第二个此前没有
  // 任何文案与之配对，实测 12.6% 的 caution 配的是一张空清单——卡上「有一点要留意」，
  // 下面一条都没有。冷侧从来就没写过文案；热侧那批落在 22–28℃，
  // 因为 weatherFit 的热负荷从 22℃ 起算而 ctx.feel 要更高才算 hot，两条线本来就不齐。
  const bottles = [
    mk({ id: 1, sillage: 1.8, sillageTier: 1, accords: acc([["citrus", 100], ["aquatic", 70]]) }), // 冷天最薄的那类
    mk({ id: 2, sillageTier: 3, accords: acc([["vanilla", 100], ["sweet", 88]]) }),
    mk({ id: 3, sillageTier: 2, accords: acc([["amber", 100], ["balsamic", 80]]) }),
    mk({ id: 4, sillageTier: 2, accords: acc([["tobacco", 100], ["leather", 70]]) }),
    mk({ id: 5, sillageTier: 2, accords: acc([["woody", 100], ["green", 50]]) }),
  ];
  let checked = 0;
  for (const tempC of [-8, 0, 2, 8, 15, 20, 23, 25, 28, 31, 35]) {
    for (const humidity of [30, 60, 85]) {
      for (const occasion of ["commute", "work", "date", "casual", "home"] as const) {
        const ctx = C({ occasion, tempC, humidity, feel: feelFromWeather(tempC, humidity) });
        for (const b of bottles) {
          const pk = buildPick(b, ctx);
          if (pk.verdict !== "caution") continue;
          checked++;
          assert.ok(
            pk.risks.length > 0,
            `${b.id} 在 ${tempC}℃/${humidity}%/${occasion} 判了 caution 却一条风险都说不出`
          );
        }
      }
    }
  }
  assert.ok(checked > 100, `样本里 caution 太少（${checked}），这条不变式等于没测`);
});

test("场景提示照常上屏，但一个字都不许动裁决——它对柜里每一瓶都成立，没有区分力", () => {
  // 一句 riskNote 曾经就能让全目录的 good 归零（实测 caution 1209 / avoid 291 / good 0），
  // 连带吃灰卡与预警卡的「换成 X」一起哑火——两者的准入闸都是 verdict === "good"。
  const bottles = [
    mk({ id: 1, accords: acc([["citrus", 100]]) }),
    mk({ id: 2, sillageTier: 3, accords: acc([["vanilla", 100], ["sweet", 90]]) }),
    mk({ id: 3, accords: acc([["woody", 100], ["green", 40]]) }),
  ];
  const plain = C({ occasion: "date", feel: "mild", tempC: 20 });
  const scened = C({ occasion: "date", feel: "mild", tempC: 20, riskNote: "初次见家长，别太张扬" });
  for (const b of bottles) {
    const a = buildPick(b, plain);
    const s = buildPick(b, scened);
    assert.equal(s.verdict, a.verdict, `${b.id}：场景提示不该改变裁决`);
    assert.equal(s.usage.suitable, a.usage.suitable, `${b.id}：场景提示不该改变 suitable`);
    // 但它必须仍然被说出来——不进裁决不等于不告诉用户
    assert.ok(s.risks.some((r) => r.includes("别太张扬")), `${b.id}：场景提示仍要上屏`);
  }
  // 无香场合是另一回事：它本来就该让每一瓶都 avoid，不能被这条豁免顺手放行
  const ff = buildPick(bottles[0], C({ occasion: "date", feel: "mild", tempC: 20, fragranceFree: true }));
  assert.equal(ff.verdict, "avoid");
  assert.equal(ff.avoidCause, "fragrance_free");
});

test("「不合场合」会随时间衰减，同场合后来的「刚好」能把它抵掉", () => {
  // scoring.ts:mismatchMul 的注释写着「反向反馈可抵消」，而聚合处此前是纯计数：
  // 半年前的一次「不合场合」和昨天的一次话语权相同，且永远抵不掉。
  const NOW = Date.UTC(2026, 6, 28);
  const DAY = 86400000;
  const at = (daysAgo: number) => NOW - daysAgo * DAY;
  const fb = (rating: Feedback["rating"], daysAgo: number): Feedback =>
    ({ perfumeId: 1, at: at(daysAgo), rating, context: C({ occasion: "work", feel: "mild", tempC: 20 }) }) as Feedback;

  const fresh = aggregateBias([fb("scene_mismatch", 1)], NOW).get(1)!;
  const stale = aggregateBias([fb("scene_mismatch", 300)], NOW).get(1)!;
  assert.ok(
    (stale.sceneMismatch?.work ?? 0) < (fresh.sceneMismatch?.work ?? 0),
    "十个月前的「不合场合」不该和昨天的一样重"
  );

  // 同场合后来又说「刚好」→ 抵掉；抵干净就不该留一个恒等于 1 的乘子占位
  const offset = aggregateBias([fb("scene_mismatch", 30), fb("perfect", 1)], NOW).get(1)!;
  assert.equal(offset.sceneMismatch, undefined, `应被抵干净：${JSON.stringify(offset.sceneMismatch)}`);
});

test("留印提示的成因必须与文案同源：烟草不许被说成树脂与浸膏", () => {
  const work = C({ occasion: "work", feel: "mild", tempC: 20 });
  const tobacco = mk({ people: 20000, sillage: 2.0, sillageTier: 2, accords: acc([["tobacco", 100], ["woody", 60]]) });
  const t = buildPick(tobacco, work).risks.find((r) => r.includes("喷衣物")) ?? "";
  assert.ok(t.includes("烟草"), `烟草触发的提示要说烟草：${t}`);
  assert.ok(!t.includes("树脂与浸膏"), `不该扣上一个它自己不成立的机制：${t}`);
  // 真正的树脂/香膏照旧说树脂
  const balsam = mk({ people: 20000, sillage: 2.0, sillageTier: 2, accords: acc([["balsamic", 100], ["oud", 70]]) });
  const b = buildPick(balsam, work).risks.find((r) => r.includes("喷衣物")) ?? "";
  assert.ok(b.includes("树脂与浸膏"), `树脂香膏仍要说树脂：${b}`);
});
