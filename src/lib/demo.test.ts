// 演示香柜（黄金集）的不变式。
// 演示态是初次到访者看到的**全部**产品，它出错等于产品出错——所以这些断言与引擎的同级。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildDemoState, demoBottlesReady, DEMO_CITY } from "./demo";
import { recommend, buildPick, aggregateBias } from "./recommend";
import { dateKey } from "./journal";
import type { Perfume, Context } from "./types";

const catalog: Perfume[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "public/data/perfumes.min.json"), "utf8")
);

// 固定"现在"：演示数据全部相对生成，所以时间必须由外部注入才可断言
const NOW = new Date("2026-07-27T14:30:00").getTime();
const DAY = 86400000;

test("演示香柜：六瓶全部能在主目录里找到", () => {
  assert.equal(demoBottlesReady(catalog), true);
  const d = buildDemoState(catalog, NOW);
  assert.ok(d);
  assert.equal(d.userPerfumes.length, 6);
});

test("演示香柜：目录缺失时返回 null，绝不给残缺的柜子", () => {
  assert.equal(buildDemoState(null, NOW), null);
  assert.equal(buildDemoState(catalog.filter((p) => p.name !== "Aventus"), NOW), null);
  assert.equal(demoBottlesReady(null), false);
});

test("演示香柜：纯函数——同一个 (catalog, now) 必得同一份状态", () => {
  assert.deepEqual(buildDemoState(catalog, NOW), buildDemoState(catalog, NOW));
});

// 反伪精确同样适用于演示数据：六瓶必须都是高票主目录香，
// 任何一瓶低票/手动记录都会让演示屏上出现"基于三票的断言"。
test("演示香柜：六瓶都是高票主目录香，没有编造数据的出口", () => {
  const d = buildDemoState(catalog, NOW)!;
  const byId = new Map(catalog.map((p) => [p.id, p]));
  for (const u of d.userPerfumes) {
    const p = byId.get(u.perfumeId)!;
    assert.ok(p, `演示瓶 ${u.perfumeId} 不在目录里`);
    assert.ok(p.people >= 1000, `${p.name} 只有 ${p.people} 人评价，不该进演示香柜`);
    assert.equal(p.lowVotes, undefined);
    assert.equal(p.custom, undefined);
    assert.notEqual(p.longevity, 0);
    assert.notEqual(p.sillage, 0);
  }
});

test("演示香柜：时间全部相对于 now，香历落在最近一个月内且不含未来", () => {
  const d = buildDemoState(catalog, NOW)!;
  const today = dateKey(NOW);
  for (const e of d.wearLog) {
    assert.ok(e.d <= today, `香历出现未来日期 ${e.d}`);
    assert.ok(e.d >= dateKey(NOW - 40 * DAY), `香历条目 ${e.d} 太旧`);
  }
  // 按日期升序且无重复日（与 store 的香历不变式一致）
  const days = d.wearLog.map((e) => e.d);
  assert.deepEqual(days, [...days].sort());
  assert.equal(new Set(days).size, days.length);
  for (const u of d.userPerfumes) {
    assert.ok(u.addedAt < NOW);
    if (u.lastWornAt != null) {
      assert.ok(u.lastWornAt <= NOW && u.lastWornAt > u.addedAt);
    }
  }
  for (const f of d.feedbacks) assert.ok(f.at < NOW);
});

test("演示香柜：预设城市，进门不弹定位授权框", () => {
  assert.equal(buildDemoState(catalog, NOW)!.city, DEMO_CITY);
});

// 演示的价值全在"进门即满配"。这三张卡任何一张哑火，演示就退化成一个普通空壳：
//   · 今日之选必须推得出、且不是 avoid
//   · 吃灰提醒必须有素材（存在搁置超 21 天的瓶）
//   · 天气突变预警必须走 basis='habit' 主线（存在唯一的最常喷瓶）
test("演示香柜：夏天的今日之选推得出来，且不是「今天不建议」", () => {
  const d = buildDemoState(catalog, NOW)!;
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const lib = d.userPerfumes.map((u) => byId.get(u.perfumeId)!);
  const ctx: Context = {
    tempC: 31, humidity: 55, windSpeed: 0, weatherText: "晴", city: DEMO_CITY,
    feel: "hot_dry", daypart: "day", season: "summer", occasion: "commute",
  };
  const rec = recommend(lib, ctx, aggregateBias(d.feedbacks), { now: NOW });
  assert.ok(rec.primary, "演示香柜推不出主推");
  assert.notEqual(rec.primary!.verdict, "avoid");
  assert.ok(rec.alternatives.length >= 2, "演示香柜给不出备选对比");
});

test("演示香柜：存在吃灰素材（搁置超 21 天、且今天判 good 的瓶）", () => {
  const d = buildDemoState(catalog, NOW)!;
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const ctx: Context = {
    tempC: 31, humidity: 55, windSpeed: 0, weatherText: "晴", city: DEMO_CITY,
    feel: "hot_dry", daypart: "day", season: "summer", occasion: "commute",
  };
  const bias = aggregateBias(d.feedbacks);
  const dusty = d.userPerfumes.filter((u) => u.lastWornAt != null && NOW - u.lastWornAt! > 21 * DAY);
  assert.ok(dusty.length >= 1, "演示香柜里没有吃灰的瓶，吃灰提醒会哑火");
  assert.ok(
    dusty.some((u) => buildPick(byId.get(u.perfumeId)!, ctx, bias.get(u.perfumeId)).verdict === "good"),
    "吃灰的瓶今天没有一瓶合适，吃灰提醒仍会哑火"
  );
});

test("演示香柜：最常喷的瓶唯一，天气突变预警走 habit 主线而非冷启动兜底", () => {
  const d = buildDemoState(catalog, NOW)!;
  const counts = d.userPerfumes.map((u) => u.wornCount ?? 0).sort((a, b) => b - a);
  assert.ok(counts[0] > counts[1], "最常喷的瓶不唯一，预警卡的归因会不稳定");
  assert.ok(counts[0] > 1, "wornCount 未超过 hooks 里的 maxWorn 初值，预警会退回冷启动形态");
});

test("演示香柜：反馈序列足以形成用香习惯，画像页不空白", () => {
  const d = buildDemoState(catalog, NOW)!;
  assert.ok(d.feedbacks.length >= 2, "反馈少于 2 条，hasHistory 不成立");
  const bias = aggregateBias(d.feedbacks);
  assert.ok(bias.size >= 2, "反馈没有聚合出任何偏置，壁垒在演示里看不见");
  // 画像页的「氛寸学到的偏好」以 |perceivedStrength| ≥ 0.4 为门槛（profile/page.tsx）。
  // 演示里必须真的越过它——否则最能体现"反馈序列是唯一壁垒"的那一栏是空的，
  // 只剩一句"多给几次反馈"。注意时间衰减：单次「太冲了」隔 19 天只剩 0.374，够不着。
  assert.ok(
    [...bias.values()].some((b) => Math.abs(b.perceivedStrength) >= 0.4),
    "没有任何一瓶的强度偏置越过画像页门槛，「氛寸学到的偏好」会是空的"
  );
});

test("演示香柜：反馈都落在它真的穿过的那天，不出现没穿却评价了的瓶", () => {
  const d = buildDemoState(catalog, NOW)!;
  const wornDays = new Set(d.wearLog.map((e) => `${e.perfumeId}@${e.d}`));
  for (const f of d.feedbacks) {
    assert.ok(
      wornDays.has(`${f.perfumeId}@${dateKey(f.at)}`),
      `反馈落在了没有穿戴记录的日子：${f.perfumeId} @ ${dateKey(f.at)}`
    );
  }
});
