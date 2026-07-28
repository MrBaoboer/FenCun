// 本机存储层的契约单测。
// 注意一个有利的巧合：Node 环境没有 window，persist 的 storage 句柄是 undefined，
// 于是每次 set 都会在 `.setItem` 上抛错——这正好**稳定复现**了浏览器里
// 「localStorage 配额写满 / Safari 隐私模式 / 存储被策略禁用」那条罕见但真实的路径。
// 也就是说这个文件里的断言在 Node 下比在浏览器里更严格。
import { test } from "node:test";
import assert from "node:assert/strict";
import { useStore, hasOwnData, guardedStorage } from "./store";

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

test("hasOwnData：只要这台机器上留下过任何一样属于他的东西，就不是新机器", () => {
  // 这条判据被 migrate、enterDemo、AppProvider 三处共用。它必须覆盖 demoPayload 会替换掉的
  // 每一项——此前三处各写一遍且都只看瓶子，于是"柜清空、香历还在"被判成新机器。
  assert.equal(hasOwnData({}), false);
  assert.equal(hasOwnData({ userPerfumes: [], customPerfumes: [], wearLog: [], feedbacks: [] }), false);
  for (const k of ["userPerfumes", "customPerfumes", "extPerfumes", "wearLog", "feedbacks"]) {
    assert.equal(hasOwnData({ [k]: [{}] }), true, `${k} 非空时必须判成"有他自己的东西"`);
  }
  assert.equal(hasOwnData({ swapCount: 1 }), true);
  assert.equal(hasOwnData({ dustyAdoptCount: 1 }), true);
  // 宽松形状：migrate 拿到的是未校验的原始对象，脏值不许把判据带偏
  assert.equal(hasOwnData({ userPerfumes: "nope", wearLog: null }), false);
});

test("演示态：装载的守卫必须看全这台机器上的一切，任何一条不满足都不许盖用户的数据", () => {
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

  // 柜清空、但香历还在 —— 这是产品自己承诺的合法状态（瓶子移出后香历依然完整），
  // 不是"一台全新的空机器"。此前守卫只看瓶子，于是这些人升级后第一次打开就被
  // 示例数据把香历（含手写手记）和反馈整包换掉，且这条路径不写 .bak，不可恢复。
  const ownHistory = [
    { d: "2026-07-01", perfumeId: 485, name: "旷野", fam: "fresh", occasion: "commute" as const, tempC: 20, weatherText: "晴", feel: "mild" as const, note: "面试那天" },
  ];
  const ownFeedback = [
    { perfumeId: 485, at: 1, context: { season: "summer" as const, daypart: "day" as const, tempC: 30, occasion: "commute" as const }, rating: "perfect" as const },
  ];
  silent(() =>
    useStore.setState({ userPerfumes: [], customPerfumes: [], wearLog: ownHistory, feedbacks: ownFeedback, demoDismissed: false })
  );
  silent(() => st().enterDemo(demo));
  assert.equal(st().demo, false, "柜空但香历/反馈还在时，不得进入演示态");
  assert.deepEqual(st().wearLog, ownHistory, "用户的香历被示例数据盖掉了");
  assert.deepEqual(st().feedbacks, ownFeedback, "用户的反馈被示例数据盖掉了");

  // 换香计数同理：它也是"这台机器上发生过什么"的痕迹
  silent(() =>
    useStore.setState({ userPerfumes: [], customPerfumes: [], wearLog: [], feedbacks: [], swapCount: 3, demoDismissed: false })
  );
  silent(() => st().enterDemo(demo));
  assert.equal(st().demo, false, "留下过换香痕迹的机器不得被当成新机器");

  // 真正干净的机器才允许装载
  silent(() =>
    useStore.setState({ userPerfumes: [], customPerfumes: [], extPerfumes: [], wearLog: [], feedbacks: [], swapCount: 0, dustyAdoptCount: 0, demoDismissed: false })
  );
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

test("写盘失败必须说出来：异常被吞掉、不打断调用方，但要立起标志", () => {
  // zustand 的 persist 把 set 包成「先改内存、再写盘」，两层包装都不 try/catch。
  // 写盘抛错时内存已经换掉 → UI 刷成"已生效"，盘上零字节，用户毫不知情；
  // 异常还会从 onClick 里逃逸，打断事件处理器——实测两处可见后果：
  // 「+ 入柜」永久停在「取数据…」、香柜的 8 秒撤销条根本不出现。
  // 读盘失败早就有 hydrateError + SiteNotice 这条通道了，写盘这一半一直没接上。
  const errs: unknown[] = [];
  const backing: Record<string, string> = { keep: "v" };
  const throwing = {
    getItem: (k: string) => backing[k] ?? null,
    removeItem: (k: string) => void delete backing[k],
    setItem: () => {
      throw new DOMException("quota", "QuotaExceededError");
    },
  } as unknown as Storage;

  const g = guardedStorage(throwing, (e) => errs.push(e));
  let after = false;
  assert.doesNotThrow(() => {
    g.setItem("fencun-store", "{}");
    after = true; // 调用方的后续语句必须照常执行
  });
  assert.equal(after, true, "异常没被吞住，调用方的后续语句会被打断");
  assert.equal(errs.length, 1, "写盘失败必须被上报一次");
  // 读与删照常转发，不受影响
  assert.equal(g.getItem("keep"), "v");
  g.removeItem("keep");
  assert.equal(g.getItem("keep"), null);
});

test("读盘失败另存的那份字节要能取回来：.bak 比导出文件多一层包装", () => {
  // 此前 .bak 只写不读——字节还在，产品里却没有任何入口去用它，等于没有恢复路径。
  // 而它存的是 persist 的包装形状 { state, version }，比导出文件多一层：
  // 直接喂 importData 会因为顶层没有 userPerfumes 被判成"不是我们的备份"。
  const st = () => useStore.getState();
  const bak = {
    version: 1,
    state: {
      userPerfumes: [{ perfumeId: 485, addedAt: 1 }],
      wearLog: [
        { d: "2026-07-01", perfumeId: 485, name: "浅蓝", fam: "citrus", occasion: "commute", tempC: 30, weatherText: "晴", feel: "hot_dry", note: "面试那天" },
      ],
      city: "上海",
    },
  };
  const mem: Record<string, string> = { "fencun-store.bak": JSON.stringify(bak) };
  const fake = {
    getItem: (k: string) => mem[k] ?? null,
    setItem: (k: string, v: string) => void (mem[k] = v),
    removeItem: (k: string) => void delete mem[k],
  };
  const g = globalThis as unknown as { window?: unknown };
  const prev = g.window;
  g.window = { localStorage: fake };
  try {
    silent(() => useStore.setState({ userPerfumes: [], wearLog: [], city: null, hydrateError: "boom" }));
    assert.equal(st().hasRescueBackup(), true, "另存的那份应当被认出来");
    assert.equal(st().restoreFromBackup(), true, "包装形状必须被剥开后再导入");
    assert.deepEqual(st().userPerfumes.map((u) => u.perfumeId), [485]);
    assert.equal(st().wearLog[0].note, "面试那天", "手记必须一并回来");
    assert.equal(st().hydrateError, null, "恢复成功后那条警告要撤掉");
    // 没有另存文件时不许假装能恢复
    delete mem["fencun-store.bak"];
    assert.equal(st().hasRescueBackup(), false);
    assert.equal(st().restoreFromBackup(), false, "没有备份时必须返回「一个字节都没动」");
  } finally {
    if (prev === undefined) delete g.window;
    else g.window = prev;
  }
});

test("采纳可撤销：穿戴计数、当天香历与隐式差评必须原样回来", () => {
  // 「也可以考虑」「从你的香柜里选」两个入口的文案都是浏览语义，点一下却写三笔。
  // 想比三瓶用法，三瓶就全被记成今天穿过——轮换的新鲜度与吃灰的 21 天计时一起重置，
  // 而 wornCount 又是预警卡判「你常喷的那瓶」的唯一依据。
  const st = () => useStore.getState();
  const day = "2026-07-20";
  const entry = (perfumeId: number, note?: string) => ({
    d: day, perfumeId, name: "x", fam: "citrus", occasion: "commute" as const,
    tempC: 20, weatherText: "晴", feel: "mild" as const, ...(note ? { note } : {}),
  });
  silent(() =>
    useStore.setState({
      userPerfumes: [{ perfumeId: 485, addedAt: 1, wornCount: 4, lastWornAt: 111 }],
      wearLog: [entry(9, "本来是这瓶")],
      swapAways: {}, swapCount: 2, dustyAdoptCount: 1,
    })
  );

  const snap = st().snapshotAdopt(485, day);
  silent(() => st().markWorn(485));
  silent(() => st().logWear(entry(485)));
  silent(() => st().recordSwap(9));
  // 前提：三笔都真的落下去了
  assert.equal(st().userPerfumes[0].wornCount, 5);
  assert.equal(st().wearLog.find((e) => e.d === day)?.perfumeId, 485);
  assert.equal(st().swapCount, 3);

  silent(() => st().undoAdopt(snap));
  assert.equal(st().userPerfumes[0].wornCount, 4, "穿戴计数没回滚");
  assert.equal(st().userPerfumes[0].lastWornAt, 111, "上次穿戴时间没回滚");
  const back = st().wearLog.find((e) => e.d === day);
  assert.equal(back?.perfumeId, 9, "被覆盖的那条香历没回来");
  assert.equal(back?.note, "本来是这瓶", "手记必须一并回来");
  assert.equal(st().swapCount, 2, "隐式差评计数没回滚");
  assert.deepEqual(st().swapAways, {}, "换香时间戳没回滚");

  // 当天原本没有记录时，撤销要把这条新建的删掉，而不是留一条空壳
  silent(() => useStore.setState({ wearLog: [], userPerfumes: [{ perfumeId: 485, addedAt: 1 }] }));
  const snap2 = st().snapshotAdopt(485, day);
  silent(() => st().logWear(entry(485)));
  silent(() => st().undoAdopt(snap2));
  assert.equal(st().wearLog.length, 0, "这次采纳才建的那条香历应当被撤掉");
});
