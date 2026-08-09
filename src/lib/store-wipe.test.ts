// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

// 盘被抹掉之后的落盘契约。
//
// 单开一个文件是必须的：store.test.ts 刻意跑在**没有 window** 的环境里（见那个文件的头注释），
// 于是 persist 的 storage 句柄是 undefined、根本不写盘。而这里要验的恰恰是"写没写回去"，
// 必须先把 window 与一个真的 localStorage 装好，再 import store。
// node --test 每个文件一个子进程，两套环境互不干扰。
import { test } from "node:test";
import assert from "node:assert/strict";

const mem = new Map<string, string>();
const fakeLS = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as unknown as Storage;

(globalThis as unknown as { window: unknown }).window = globalThis;
Object.defineProperty(globalThis, "localStorage", { value: fakeLS, configurable: true });

const flush = () => new Promise((r) => setTimeout(r, 0));

test("盘被抹掉之后，这一页不许把内存里那份原样写回去", async () => {
  // 这是本轮实测到的 P0：用户在浏览器设置里「清除本站数据」、或在另一个标签页 clear()，
  // 只要还有一个氛寸页面开着，香柜、香历、手记与城市就会在**零操作**下被完整写回磁盘。
  // 链路：storage 事件(key=null) → rehydrate() → zustand 盘上取不到值时 merge(undefined, get())
  // 保留内存态 → onRehydrateStorage 成功分支 setState → persist 立刻写盘。
  const { useStore, STORE_KEY, isStorageWipe } = await import("./store");

  useStore.setState({
    userPerfumes: [{ perfumeId: 485, addedAt: Date.now(), wornCount: 3 }],
    wearLog: [{ d: "2026-07-20", perfumeId: 485, note: "面试那天" }] as never,
  });
  await flush();

  const seeded = mem.get(STORE_KEY) ?? "";
  assert.ok(seeded.length > 0, "前提：正常状态下确实会落盘");
  assert.ok(seeded.includes("面试那天"), "前提：手记确实进了盘");

  // 用户清空本站数据
  fakeLS.clear();
  assert.equal(mem.has(STORE_KEY), false, "前提：盘上已经空了");

  // 页面收到 storage 事件。判据必须认出这是"抹除"而不是"另一页写了新东西"
  assert.equal(isStorageWipe(null, null), true);
  useStore.getState().noteStorageWiped();
  await flush();

  assert.equal(
    mem.has(STORE_KEY),
    false,
    "抹除之后不许再落盘——写回去等于替用户撤销了他刚做的清除"
  );
  assert.equal(useStore.getState().storageWiped, true, "要立起标志，由 SiteNotice 告诉用户");
  assert.equal(
    useStore.getState().wearLog.length,
    1,
    "内存里那份要留着：它是最后一份，用户还得有机会导出"
  );

  // 冻结之后任何后续写入都不许落盘（noteStorageWiped 里 writesFrozen 先于 setState）
  useStore.setState({ occasion: "date" });
  await flush();
  assert.equal(mem.has(STORE_KEY), false, "冻结之后的每一次 set 都不许落盘");

  // 纵深：判据挡的是"自动重读"这一条路，冻结挡的是"写回"这件事本身。
  // 就算日后别处又调了一次 rehydrate（它内部那句 setState 正是写回的引信），也不许落盘。
  await useStore.persist?.rehydrate();
  await flush();
  assert.equal(mem.has(STORE_KEY), false, "抹除后即便走到 rehydrate，冻结也要兜住");
});
