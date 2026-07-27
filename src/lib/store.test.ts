// 本机存储层的契约单测。
// 注意一个有利的巧合：Node 环境没有 window，persist 的 storage 句柄是 undefined，
// 于是每次 set 都会在 `.setItem` 上抛错——这正好**稳定复现**了浏览器里
// 「localStorage 配额写满 / Safari 隐私模式 / 存储被策略禁用」那条罕见但真实的路径。
// 也就是说这个文件里的断言在 Node 下比在浏览器里更严格。
import { test } from "node:test";
import assert from "node:assert/strict";
import { useStore } from "./store";

// 本环境下每次 set 都会在写盘那一步抛（见文件头注释）。zustand 是**先改内存、再写盘**，
// 所以异常之后内存状态已经是新的——吞掉它，断言照常针对内存状态成立。
// 这同时正是浏览器里"配额写满"那条路径的行为：状态变了，只是没落盘。
function silent(fn: () => void) {
  try {
    fn();
  } catch {}
}

test("importData 返回 false 只能意味着「一个字节都没动」", () => {
  // 原实现把校验和 set 一起包在 try 里：写盘抛错 → 走 catch → 返回 false，
  // 而此时内存状态**早已被替换**，UI 却会照着 false 说出
  // 「导入没能完成，现在的数据没有被改动」——这句话是谎话。
  const st = () => useStore.getState();

  // ① 非 JSON → 拒收，状态不变
  const before = st().userPerfumes.length;
  assert.equal(st().importData("这不是 JSON"), false);
  assert.equal(st().userPerfumes.length, before, "被拒时不得改动状态");

  // ② JSON 但不是我们的备份 → 拒收，状态不变
  assert.equal(st().importData(JSON.stringify({ 随便: 1 })), false);
  assert.equal(st().userPerfumes.length, before, "被拒时不得改动状态");

  // ③ userPerfumes 全部损坏 → 拒收（不是我们的备份），状态不变
  assert.equal(st().importData(JSON.stringify({ userPerfumes: [{ 坏: true }] })), false);
  assert.equal(st().userPerfumes.length, before, "被拒时不得改动状态");

  // ④ 合法备份 → 必须返回 true 并真的落库。
  //    本环境下 persist 一定会在写盘时抛错，正是要守的那条路径：
  //    状态已换掉，就不许再报告成"没有改动"。
  const good = JSON.stringify({
    userPerfumes: [{ perfumeId: 485, addedAt: Date.now() }],
    city: "北京",
    occasion: "commute",
  });
  assert.equal(st().importData(good), true, "写盘失败也不得反过来说没导入");
  assert.equal(st().userPerfumes.length, 1);
  assert.equal(st().city, "北京");
});

test("previewImport：先看清代价，再决定要不要覆盖", () => {
  const st = () => useStore.getState();
  assert.equal(st().previewImport("这不是 JSON"), null);
  const raw = JSON.stringify({
    userPerfumes: [
      { perfumeId: 485, addedAt: 1 },
      { perfumeId: 17, addedAt: 2 },
    ],
    feedbacks: [
      {
        perfumeId: 485,
        at: 1,
        context: { season: "summer", daypart: "day", tempC: 30, occasion: "commute" },
        rating: "perfect",
      },
    ],
    wearLog: [
      { d: "2026-07-01", perfumeId: 485, name: "浅蓝", fam: "citrus", occasion: "commute", tempC: 30, weatherText: "晴", feel: "hot_dry" },
      { d: "2026-07-01", perfumeId: 17, name: "大地", fam: "citrus", occasion: "work", tempC: 30, weatherText: "晴", feel: "hot_dry" },
    ],
  });
  // 香历按日去重：同一天两条只算一天——预览给的数字必须和真正落库后一致
  assert.deepEqual(st().previewImport(raw), { perfumes: 2, feedbacks: 1, wearDays: 1 });
  st().importData(raw);
  assert.equal(st().wearLog.length, 1, "预览数与实际落库数必须一致");
});

test("导入校验的必填面必须覆盖消费面：缺 notes 的快照不得放行", () => {
  // 香气档案卡直接读 p.notes.top/middle/base。schema 此前不校验它（对象上是 .loose()），
  // 于是一份缺 notes 的备份能导入成功、在用户点开详情页那一刻才崩。
  const st = () => useStore.getState();
  const snap = (over: Record<string, unknown> = {}) => ({
    id: -1, name: "自建", nameZh: "自建", aliases: [], brand: "x", brandZh: "x",
    gender: "unisex", accords: [],
    seasonPct: { winter: 0.25, spring: 0.25, summer: 0.25, autumn: 0.25 },
    daypartPct: { day: 0.5, night: 0.5 }, sillageTier: 2, styleTags: [],
    notes: { top: [], middle: [], base: [] },
    ...over,
  });
  const raw = (custom: unknown[]) =>
    JSON.stringify({ userPerfumes: [{ perfumeId: -1, addedAt: 1 }], customPerfumes: custom });

  // 缺 notes → 该条被丢弃（宽进严出：坏的单条丢掉，不整包拒收）
  const bad = snap();
  delete (bad as Record<string, unknown>).notes;
  silent(() => st().importData(raw([bad])));
  assert.equal(st().customPerfumes.length, 0, "缺 notes 的快照被放行了");

  // 完整的照常收下
  silent(() => st().importData(raw([snap()])));
  assert.equal(st().customPerfumes.length, 1);
  assert.deepEqual(st().customPerfumes[0].notes, { top: [], middle: [], base: [] });
});

test("移出香柜时 swapAways 一并清理，不在本机永久累积", () => {
  const st = () => useStore.getState();
  silent(() => useStore.setState({ userPerfumes: [], extPerfumes: [], customPerfumes: [], swapAways: {} }));
  silent(() => st().addPerfume(485));
  silent(() => st().recordSwap(485));
  assert.ok(st().swapAways["485"]?.length === 1, "换香时间戳没记上");
  silent(() => st().removePerfume(485));
  assert.equal(st().swapAways["485"], undefined, "瓶子移出了，它的换香时间戳还留在盘上");
});

test("演示态：装载有三道守卫，任何一条不满足都不许盖用户的柜子", () => {
  const st = () => useStore.getState();
  const demo = {
    userPerfumes: [{ perfumeId: 1825, addedAt: 1, wornCount: 9 }],
    feedbacks: [],
    wearLog: [],
    city: "北京",
    occasion: "commute" as const,
  };

  // 自己造前置条件，不依赖前一个用例的遗留状态（那种耦合会让用例顺序一变就红）
  silent(() =>
    useStore.setState({ userPerfumes: [{ perfumeId: 485, addedAt: 1 }], customPerfumes: [], demo: false, demoDismissed: false })
  );
  // 非空柜必须拒绝装载
  assert.ok(st().userPerfumes.length > 0);
  silent(() => st().enterDemo(demo));
  assert.equal(st().demo, false, "柜非空时不得进入演示态");
  assert.notEqual(st().userPerfumes[0].perfumeId, 1825, "演示数据盖掉了用户的香柜");

  // 清空后（模拟新机器）才允许装载
  silent(() => useStore.setState({ userPerfumes: [], customPerfumes: [], demoDismissed: false }));
  silent(() => st().enterDemo(demo));
  assert.equal(st().demo, true);
  assert.equal(st().userPerfumes.length, 1);

  // 用户加自己的第一瓶 → 演示整体退场，不与真实数据混柜
  silent(() => st().addPerfume(485));
  assert.equal(st().demo, false, "加瓶之后演示态必须退场");
  assert.equal(st().demoDismissed, true);
  assert.deepEqual(st().userPerfumes.map((u) => u.perfumeId), [485], "演示的瓶必须被清干净");

  // 退出过一次就永不再自动装载
  silent(() => st().enterDemo(demo));
  assert.equal(st().demo, false, "dismissed 之后不得再次进入演示态");
});

test("重置：清掉本机的一切，再把示例香柜原样装回来，城市与场景一并复位", () => {
  const st = () => useStore.getState();
  const demo = {
    userPerfumes: [{ perfumeId: 1825, addedAt: 1 }],
    feedbacks: [
      { perfumeId: 1825, at: 1, context: { season: "winter" as const, daypart: "night" as const, tempC: 5, occasion: "date" as const }, rating: "perfect" as const },
    ],
    wearLog: [
      { d: "2026-07-01", perfumeId: 1825, name: "烟草香草", fam: "sweet", occasion: "date" as const, tempC: 5, weatherText: "晴", feel: "cold" as const },
    ],
    city: "北京",
    occasion: "commute" as const,
  };

  // 先造一柜用户自己的东西 + 一些计数
  silent(() =>
    useStore.setState({
      userPerfumes: [{ perfumeId: 485, addedAt: 1 }],
      customPerfumes: [],
      extPerfumes: [],
      wearLog: [],
      feedbacks: [],
      swapCount: 7,
      demo: false,
      demoDismissed: true,
      city: null,
    })
  );
  silent(() => st().setCity("上海")); // 用户改过城市，重置后应被复位

  silent(() => st().resetToDemo(demo));
  assert.equal(st().demo, true, "重置后应回到示例香柜");
  assert.equal(st().demoDismissed, false, "重置等于回到第一次打开，dismissed 必须一并复位");
  assert.deepEqual(st().userPerfumes.map((u) => u.perfumeId), [1825], "用户自己的瓶必须被清掉、示例必须装回");
  assert.equal(st().feedbacks.length, 1);
  assert.equal(st().wearLog.length, 1);
  assert.equal(st().swapCount, 0, "证伪计数也要归零，否则重置不彻底");
  // 城市也属于"初始状态"的一部分：新用户第一次打开时看到的就是北京。
  // 调用方随即会重新解析一次天气（见 profile 页），所以屏上不会出现城市与读数对不上。
  assert.equal(st().city, "北京", "重置应把城市一并复位到初始的北京");
});
