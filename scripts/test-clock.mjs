// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

// npm test 的运行环境：墙上时钟固定从 TEST_EPOCH 起走，时区固定为 Asia/Shanghai。
// 由 package.json 的 test 脚本以 --import 预载，每个测试进程开头各装一次。
//
// 为什么固定：演示香柜的四季用例漏传过 now，偏置衰减按「跑测试的那天」算——同一个提交
// 2026-10-16 是绿的，10-18 起在一个只动了锁文件的依赖 PR（#73）上红了。测试结果只能由
// 提交决定，不能由哪天跑、在哪台机器上跑决定。
//
// 起点选在离一切用例锚点（2026–2027）都很远的 2031 年：凡是「拿写死的日期造数据、却按
// 墙上时钟算」的用例，写下的当天就红，而不是几个月后在一个无关的 PR 上红。时钟照常流动
// （只平移起点），限流窗口、耗时这类相对时长不受影响。
//
// 时区不用 CI 默认的 UTC：在 UTC 里本地日与 UTC 日重合，「跨本地零点而非 UTC 零点」
// 这类回归（dayFloor 那条，旧实现在北京早上 8 点翻天）在 CI 上根本测不出来。
export const TEST_EPOCH = Date.parse("2031-03-17T11:17:00+08:00");
export const TEST_TZ = "Asia/Shanghai";

process.env.TZ = TEST_TZ;

const RealDate = Date;
const offset = TEST_EPOCH - RealDate.now();
const now = () => RealDate.now() + offset;

// 用 Proxy 而不是子类：不带 new 的 Date() 照样能调，装上之前创建的 Date 仍然 instanceof Date。
globalThis.Date = new Proxy(RealDate, {
  construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now()], newTarget),
  apply: () => new RealDate(now()).toString(),
  get: (target, key, receiver) => (key === "now" ? now : Reflect.get(target, key, receiver)),
});
