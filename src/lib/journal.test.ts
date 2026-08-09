// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

// 香历纯函数单测：日期键、月网格、族群色点、条目快照、备选差异标签
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateKey, monthGrid, dominantFamily, familyColor, wearEntryFrom, altDiffLabel } from "./journal";
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
    weatherText: "多云",
    city: "上海",
    feel: "mild",
    daypart: "day",
    season: "spring",
    occasion: "work",
    ...o,
  };
}

test("dateKey：本地日期、零填充", () => {
  assert.equal(dateKey(new Date(2026, 6, 8, 7, 50).getTime()), "2026-07-08");
  assert.equal(dateKey(new Date(2026, 0, 1, 23, 59).getTime()), "2026-01-01");
});

test("monthGrid：周一起始、补位正确、天数齐全", () => {
  // 2026-07-01 是周三 → 前导 2 个空位
  const july = monthGrid(2026, 6);
  assert.equal(july[0][0], null);
  assert.equal(july[0][1], null);
  assert.equal(july[0][2], 1);
  const days = july.flat().filter((d): d is number => d != null);
  assert.equal(days.length, 31);
  assert.equal(days[0], 1);
  assert.equal(days[30], 31);
  for (const week of july) assert.equal(week.length, 7);
  // 闰年二月
  const feb2028 = monthGrid(2028, 1).flat().filter((d) => d != null);
  assert.equal(feb2028.length, 29);
});

test("dominantFamily：取强度最高且能归族的 accord；空/未知 → other", () => {
  assert.equal(dominantFamily(mk({ accords: acc([["citrus", 80], ["woody", 60]]) })).key, "citrus");
  assert.equal(dominantFamily(mk({ accords: acc([["oud", 70]]) })).key, "dark");
  assert.equal(dominantFamily(mk({ accords: [] })).key, "other");
  assert.ok(familyColor("citrus").startsWith("#"));
  assert.equal(familyColor("不存在的"), familyColor("other"));
});

test("wearEntryFrom：快照完整；降级情境不记编造的温度", () => {
  const at = new Date(2026, 6, 8, 9, 0).getTime();
  const e = wearEntryFrom(mk({ nameZh: "蓝风铃", accords: acc([["floral", 70]]) }), C(), at);
  assert.equal(e.d, "2026-07-08");
  assert.equal(e.name, "蓝风铃");
  assert.equal(e.fam, "floral");
  assert.equal(e.tempC, 20);
  const degraded = wearEntryFrom(mk(), C({ approximate: true, tempC: 27 }), at);
  assert.equal(degraded.tempC, null, "降级情境的代表温度不进香历");
});

test("altDiffLabel：一句话说清备选和主推差在哪", () => {
  const base = mk({ id: 1, sillageTier: 3, longevity: 3, accords: acc([["woody", 70]]) });
  assert.equal(altDiffLabel(mk({ id: 2, sillageTier: 1 }), base), "更收敛");
  assert.equal(altDiffLabel(mk({ id: 3, sillageTier: 4, accords: acc([["woody", 70]]) }), base), "更有存在感");
  assert.equal(altDiffLabel(mk({ id: 4, sillageTier: 3, longevity: 4.2, accords: acc([["woody", 70]]) }), base), "留香更久");
  assert.equal(altDiffLabel(mk({ id: 5, sillageTier: 3, longevity: 3, accords: acc([["citrus", 70]]) }), base), "换个气质");
  assert.equal(altDiffLabel(mk({ id: 6, sillageTier: 3, longevity: 3, accords: acc([["woody", 70]]) }), base), "同路数替补");
});
