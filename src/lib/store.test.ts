// 本机存储层的契约单测。
// 注意一个有利的巧合：Node 环境没有 window，persist 的 storage 句柄是 undefined，
// 于是每次 set 都会在 `.setItem` 上抛错——这正好**稳定复现**了浏览器里
// 「localStorage 配额写满 / Safari 隐私模式 / 存储被策略禁用」那条罕见但真实的路径。
// 也就是说这个文件里的断言在 Node 下比在浏览器里更严格。
import { test } from "node:test";
import assert from "node:assert/strict";
import { useStore } from "./store";

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
