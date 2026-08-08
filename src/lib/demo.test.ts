// 演示香柜（黄金集）的不变式。
// 演示态是初次到访者看到的**全部**产品，它出错等于产品出错——所以这些断言与引擎的同级。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildDemoState, demoBottlesReady, DEMO_CITY } from "./demo";
import { recommend, buildPick, aggregateBias } from "./recommend";
import { pickNudges } from "./nudges";
import { seasonFromDateTemp, feelFromWeather, daypartFromHour } from "./season";
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

test("演示香柜：同一天同一瓶，香历与用香记录必须是同一个读数", () => {
  // wearLog 与 feedbacks 是两个独立数组、各自 map，此前各拿自己的数组下标去取天气样本，
  // 于是同一件事在香历里是「31℃ · 晴」、在「我的 · 用香记录」里却是 28℃——
  // 同一份门面数据给出两个互相矛盾的读数，而其中一个已经印进 README 引用的截图。
  // 26↔28、31↔26 还都跨了 tempBand 边界，连「成功配置复用」的命中键都会对不上。
  const d = buildDemoState(catalog, NOW)!;
  const byDay = new Map(d.wearLog.map((e) => [`${e.perfumeId}@${e.d}`, e]));
  for (const f of d.feedbacks) {
    const w = byDay.get(`${f.perfumeId}@${dateKey(f.at)}`);
    assert.ok(w, `反馈没有对应的穿戴记录：${f.perfumeId}`);
    assert.equal(f.context.tempC, w!.tempC, `同一天的温度对不上：香历 ${w!.tempC}℃ vs 反馈 ${f.context.tempC}℃`);
    assert.equal(f.context.feel, w!.feel, "同一天的体感档对不上");
  }
});

test("演示香柜：给定 now 必得同一份状态（纯函数，可用于截图脚本）", () => {
  const a = JSON.stringify(buildDemoState(catalog, NOW));
  const b = JSON.stringify(buildDemoState(catalog, NOW));
  assert.equal(a, b);
});

// ——— 四季不变式 ———
// 上面那批断言全部钉在 NOW（7 月 27 日）这一个夏日上，于是一个只在秋冬发作的缺陷
// 活了整整半年：实测 7 个场合 × 365 天，9 月 1 日到次年 2 月 28 日共 181 天两张
// 发现型钩子一张都弹不出——蓝风铃反季进不了吃灰筛子、烟草香草当季不是 avoid。
// 单季用例看不见换季才反转的前提，所以下面这几条一律跑满四季。
const SEASON_DAYS: { label: string; iso: string; tempC: number; humidity: number }[] = [
  { label: "春", iso: "2026-04-15T14:30:00", tempC: 15, humidity: 43 },
  { label: "夏", iso: "2026-07-27T14:30:00", tempC: 27, humidity: 75 },
  { label: "秋", iso: "2026-10-15T14:30:00", tempC: 13, humidity: 63 },
  { label: "冬", iso: "2027-01-15T14:30:00", tempC: -3, humidity: 44 },
];

/** 按真实链路派生 Context——必填字段一个都不能少，否则会算出并不存在的缺陷 */
function ctxFor(at: number, tempC: number, humidity: number): Context {
  const dt = new Date(at);
  return {
    tempC, humidity, windSpeed: 0, weatherText: "晴", city: DEMO_CITY,
    feel: feelFromWeather(tempC, humidity),
    daypart: daypartFromHour(dt.getHours()),
    season: seasonFromDateTemp(dt, tempC),
    occasion: "commute", // 首访默认场合：这就是初次到访者实际看到的那一屏
  };
}

test("演示香柜：四季都弹得出两张发现型钩子（产品自称的价值重心，不许只在夏天成立）", () => {
  for (const s of SEASON_DAYS) {
    const now = new Date(s.iso).getTime();
    const d = buildDemoState(catalog, now)!;
    const byId = new Map(catalog.map((p) => [p.id, p]));
    const lib = d.userPerfumes.map((u) => byId.get(u.perfumeId)!);
    const bias = aggregateBias(d.feedbacks);
    const ctx = ctxFor(now, s.tempC, s.humidity);
    const rec = recommend(lib, ctx, bias, {
      daySeed: Math.floor(now / 86400000),
      lastWornAt: new Map(
        d.userPerfumes.filter((u) => u.lastWornAt != null).map((u) => [u.perfumeId, u.lastWornAt!])
      ),
      now,
    });
    const ns = pickNudges({ lib, userPerfumes: d.userPerfumes, feedbacks: d.feedbacks, ctx, rec, now });
    assert.ok(ns.some((n) => n.kind === "dusty"), `${s.label}：吃灰提醒哑火`);
    const w = ns.find((n) => n.kind === "weather");
    assert.ok(w, `${s.label}：天气突变预警哑火`);
    assert.equal(w!.kind === "weather" && w!.basis, "habit", `${s.label}：预警退回了冷启动兜底形态`);
  }
});

test("演示香柜：四季的反馈都落在它真的穿过的那天（换季换脚本时最容易破的一条）", () => {
  for (const s of SEASON_DAYS) {
    const now = new Date(s.iso).getTime();
    const d = buildDemoState(catalog, now)!;
    const byDay = new Map(d.wearLog.map((e) => [`${e.perfumeId}@${e.d}`, e]));
    for (const f of d.feedbacks) {
      const w = byDay.get(`${f.perfumeId}@${dateKey(f.at)}`);
      assert.ok(w, `${s.label}：反馈没有对应的穿戴记录（${f.perfumeId}）`);
      assert.equal(f.context.tempC, w!.tempC, `${s.label}：同一天的温度对不上`);
    }
  }
});

test("演示香柜：四季的最常喷瓶都唯一，且反馈足以让壁垒在画像页现形", () => {
  for (const s of SEASON_DAYS) {
    const now = new Date(s.iso).getTime();
    const d = buildDemoState(catalog, now)!;
    const counts = d.userPerfumes.map((u) => u.wornCount ?? 0).sort((a, b) => b - a);
    assert.ok(counts[0] > counts[1], `${s.label}：最常喷的瓶不唯一，预警卡归因会不稳定`);
    assert.ok(counts[0] > 1, `${s.label}：wornCount 未超过 maxWorn 初值，预警会退回冷启动`);
    // 画像页「氛寸学到的偏好」门槛是 |perceivedStrength| ≥ 0.4：
    // 同一瓶必须凑够两次「太冲了」，单次会被时间衰减吃到够不着。
    const bias = aggregateBias(d.feedbacks);
    assert.ok(
      [...bias.values()].some((b) => Math.abs(b.perceivedStrength) >= 0.4),
      `${s.label}：没有一瓶跨过画像页门槛，壁垒在演示里是隐形的`
    );
  }
});
