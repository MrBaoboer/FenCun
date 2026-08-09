// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

// 发现型钩子的回归网。它此前长在 hooks.ts 里、被 useApp 的反向 import 关在
// node --test 够不着的地方——全应用分支最密的一段逻辑只能靠线上发现问题，
// 历史上「换成你已经拿到的那瓶」就是这么漏出去的。
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickNudges, DUSTY_MS } from "./nudges";
import { recommend } from "./recommend";
import type { Perfume, Context, UserPerfume } from "./types";

const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 6, 28, 4, 0, 0);

function mk(id: number, o: Partial<Perfume> = {}): Perfume {
  return {
    id,
    name: `P${id}`,
    nameZh: `香${id}`,
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
    accords: [{ en: "citrus", zh: "柑橘", strength: 100 }],
    notes: { top: [], middle: [], base: [] },
    notesFlat: [],
    styleTags: ["日常百搭"],
    popularity: 100,
    people: 20000,
    ...o,
  };
}
function C(o: Partial<Context> = {}): Context {
  return {
    tempC: 22, humidity: 50, windSpeed: 0, weatherText: "晴", city: "北京",
    feel: "mild", daypart: "day", season: "summer", occasion: "casual", ...o,
  };
}
const up = (perfumeId: number, o: Partial<UserPerfume> = {}): UserPerfume => ({
  perfumeId, addedAt: NOW - 200 * DAY, ...o,
});

function run(lib: Perfume[], userPerfumes: UserPerfume[], ctx: Context, feedbacks = []) {
  const rec = recommend(lib, ctx, new Map(), { now: NOW })!;
  return { rec, nudges: pickNudges({ lib, userPerfumes, feedbacks, ctx, rec, now: NOW }) };
}

test("吃灰提醒：搁置过 21 天线、今天又恰好合适的那瓶才翻出来", () => {
  // 柜里三瓶：两瓶清爽通勤香（其中一瓶前天刚穿、吃轮换惩罚），一瓶花香搁置了 22 天。
  // 通勤场合对花香扣分，所以主推落在清爽那瓶——吃灰卡要求"不是今天的主推"，
  // 这个前提必须由构造保证，否则测的就不是这条规则。
  const floral = mk(2, { accords: [{ en: "floral", zh: "花香", strength: 100 }] });
  const lib = [mk(1), floral, mk(3)];
  const ctx = C({ occasion: "commute" });
  const { rec, nudges } = run(lib, [
    up(1, { lastWornAt: NOW - 2 * DAY, wornCount: 5 }),
    up(2, { lastWornAt: NOW - (DUSTY_MS + DAY), wornCount: 1 }),
    up(3, { lastWornAt: NOW - 10 * DAY, wornCount: 3 }),
  ], ctx);
  assert.notEqual(rec.primary?.perfume.id, 2, "前提：搁置的那瓶不是今天的主推");
  const d = nudges.find((n) => n.kind === "dusty");
  assert.ok(d, `应当有吃灰卡：${JSON.stringify(nudges.map((n) => n.kind))}`);
  assert.equal(d.kind === "dusty" && d.perfume.id, 2);
  assert.ok(d.kind === "dusty" && d.days >= 21, "搁置天数要如实报出来");

  // 都在近期穿过时，一张吃灰卡都不该有
  const { nudges: none } = run(lib, [
    up(1, { lastWornAt: NOW - 2 * DAY }),
    up(2, { lastWornAt: NOW - 3 * DAY }),
    up(3, { lastWornAt: NOW - 10 * DAY }),
  ], ctx);
  assert.equal(none.some((n) => n.kind === "dusty"), false);
});

test("一屏之内同一瓶只该被推荐一次：better 不得是主推，也不得是吃灰卡刚推过的那瓶", () => {
  // 冬香在夏天判 avoid（反季），柜里另有两瓶清爽香
  const winter = mk(9, {
    accords: [
      { en: "vanilla", zh: "香草", strength: 100 },
      { en: "sweet", zh: "甜", strength: 92 },
    ],
    seasonPct: { winter: 0.6, spring: 0.15, summer: 0.05, autumn: 0.2 },
  });
  const lib = [mk(1), mk(2), winter];
  const ctx = C();
  const { rec, nudges } = run(lib, [
    up(1, { lastWornAt: NOW - 2 * DAY }),
    up(2, { lastWornAt: NOW - (DUSTY_MS + DAY) }),
    up(9, { lastWornAt: NOW - 5 * DAY, wornCount: 9 }),
  ], ctx);

  const w = nudges.find((n) => n.kind === "weather");
  assert.ok(w, `应当有预警卡：${JSON.stringify(nudges.map((n) => n.kind))}`);
  if (w.kind !== "weather") return;
  assert.equal(w.habitual.id, 9, "常喷的那瓶该由 wornCount 定");
  assert.equal(w.basis, "habit");
  const dustyId = nudges.find((n) => n.kind === "dusty")?.kind === "dusty"
    ? (nudges.find((n) => n.kind === "dusty") as { perfume: Perfume }).perfume.id
    : null;
  assert.notEqual(w.better?.id, rec.primary?.perfume.id, "「换成 X」不得是下面那瓶主推");
  assert.notEqual(w.better?.id, w.habitual.id, "不得让人换成他自己那瓶");
  if (dustyId != null) assert.notEqual(w.better?.id, dustyId, "不得与吃灰卡推同一瓶");
  // 眉标与正文必须同源
  assert.equal(w.cause, "season");
  assert.ok(w.reason.includes("反季"), `正文要跟着成因走：${w.reason}`);
});

test("柜里每一瓶都不宜时不再弹噪音卡——主推卡已经把这件事说完了", () => {
  // 全是冬香，夏天全判反季 → allAvoid
  const winter = (id: number) =>
    mk(id, {
      accords: [
        { en: "vanilla", zh: "香草", strength: 100 },
        { en: "sweet", zh: "甜", strength: 92 },
      ],
      seasonPct: { winter: 0.6, spring: 0.15, summer: 0.05, autumn: 0.2 },
    });
  const lib = [winter(1), winter(2)];
  const ctx = C();
  const { rec, nudges } = run(lib, [up(1, { wornCount: 9 }), up(2)], ctx);
  assert.equal(rec.allAvoid, true, "前提：柜里每一瓶都被判不宜");
  assert.equal(nudges.some((n) => n.kind === "weather"), false, "此时再叠一张预警卡只是噪音");
});

test("无香场合：一张卡都不弹（主推卡已经说了今天别用香）", () => {
  const lib = [mk(1), mk(2)];
  const ctx = C({ fragranceFree: true });
  const { nudges } = run(lib, [up(1, { wornCount: 9 }), up(2, { lastWornAt: NOW - 60 * DAY })], ctx);
  assert.deepEqual(nudges, []);
});

test("降级情境（拿不到真实天气）不弹预警卡——不用人造体感冒充「天气突变」", () => {
  const winter = mk(9, {
    accords: [
      { en: "vanilla", zh: "香草", strength: 100 },
      { en: "sweet", zh: "甜", strength: 92 },
    ],
    seasonPct: { winter: 0.6, spring: 0.15, summer: 0.05, autumn: 0.2 },
  });
  const lib = [mk(1), winter];
  const ctx = C({ approximate: true });
  const { nudges } = run(lib, [up(1), up(9, { wornCount: 9 })], ctx);
  assert.equal(nudges.some((n) => n.kind === "weather"), false);
});

test("冷启动兜底：还没有用香习惯时退回库里被判不宜的那瓶，且文案不冒称个性化", () => {
  const winter = mk(9, {
    accords: [
      { en: "vanilla", zh: "香草", strength: 100 },
      { en: "sweet", zh: "甜", strength: 92 },
    ],
    seasonPct: { winter: 0.6, spring: 0.15, summer: 0.05, autumn: 0.2 },
  });
  const lib = [mk(1), mk(2), winter];
  const ctx = C();
  // 全都没穿过 → 没有 wornCount 信号
  const { nudges } = run(lib, [up(1), up(2), up(9)], ctx);
  const w = nudges.find((n) => n.kind === "weather");
  assert.ok(w, "冷启动周不该哑火");
  assert.equal(w.kind === "weather" && w.basis, "cold", "不是「常喷」，文案不能冒称个性化");
});
