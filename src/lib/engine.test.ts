// 打分/用法/编排引擎单测 —— 确定性纯函数，锁定权重、乘子方向与边界，防重构悄悄改错。
// 运行：npm test（node --import tsx --test）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  score,
  seasonFit,
  daypartFit,
  weatherMultiplier,
  occasionFit,
  qualityPrior,
  avoidPenalty,
} from "./scoring";
import { computeUsage, computeRisks } from "./usage";
import { buildPick, recommend, freshness, swapPenalty, dayFloor, aggregateBias } from "./recommend";
import { feelFromWeather } from "./season";
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

test("seasonFit：主场季得 1，反季按相对占比", () => {
  const p = mk({ seasonPct: { winter: 0.1, spring: 0.1, summer: 0.6, autumn: 0.2 } });
  assert.equal(seasonFit(p, "summer"), 1);
  assert.ok(Math.abs(seasonFit(p, "winter") - 0.1 / 0.6) < 1e-9);
});

test("daypartFit：相对自身主场归一（偏夜香在夜里得 1）", () => {
  const p = mk({ daypartPct: { day: 0.2, night: 0.8 } });
  assert.equal(daypartFit(p, C({ daypart: "night" })), 1);
  assert.ok(Math.abs(daypartFit(p, C({ daypart: "day" })) - 0.25) < 1e-9);
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

test("feelFromWeather：回南天/梅雨（22℃/90%）按闷湿处理，不再判温和", () => {
  assert.equal(feelFromWeather(22, 90), "hot_humid");
  assert.equal(feelFromWeather(22, 60), "mild");
  assert.equal(feelFromWeather(30, 70), "hot_humid");
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

test("selectExtHits：强命中无视主目录垃圾计数（「观夏」回归）；无强命中时才看主目录贫瘠度", async () => {
  const { selectExtHits } = await import("./perfumes");
  const guanxia = [
    { i: 1, n: "Triple Tea 三重茶", b: "To Summer | 观夏", p: 261 },
    { i: 2, n: "Cedarwood 昆仑煮雪", b: "To Summer | 观夏", p: 80 },
  ];
  const junk = [
    { i: 9, n: "Random Summer", b: "Nobody", p: 10 },
    { i: 10, n: "Another", b: "Nobody", p: 9 },
  ];
  // 回归核心：主目录被「夏」字垃圾命中凑到 7 条时，观夏的强命中仍必须给出
  const picked = selectExtHits([...junk, ...guanxia], "观夏", 7);
  assert.deepEqual(picked.map((e) => e.i), [1, 2]);
  // 多词段：每段都得是连续子串
  assert.deepEqual(selectExtHits([...junk, ...guanxia], "观夏 三重茶", 7).map((e) => e.i), [1]);
  // 无强命中 + 主目录已有像样结果 → 不放噪音
  assert.deepEqual(selectExtHits(junk, "蓝风铃", 5), []);
  // 无强命中 + 主目录贫瘠 → 放出模糊命中兜底（拼写误差/英文场景）
  assert.equal(selectExtHits(junk, "sumer", 0).length, 2);
});

test("riskNote：场景解析的社交风险以受控字段进入风险列表", () => {
  const p = mk({ accords: acc([["citrus", 60]]) });
  const risks = computeRisks(p, C({ occasion: "formal", feel: "mild", tempC: 20, riskNote: "婚礼焦点是新人，不宜喧宾夺主" }));
  assert.ok(risks.some((r) => r.includes("喧宾夺主")));
});
