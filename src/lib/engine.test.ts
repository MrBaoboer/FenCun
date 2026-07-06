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
import { computeUsage } from "./usage";
import { buildPick, recommend } from "./recommend";
import type { Perfume, Context } from "./types";

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
