// 默认主题的守卫。
//
// 这是一条产品决定，不是实现细节：**默认恒为明韵（浅色）**，既不按时段自动翻，
// 也不读 prefers-color-scheme；暗香只在用户亲手切过之后出现。
// 决定本身写在注释里会随重构一起消失，所以在这里用可执行的断言钉住。
//
// 断言对象是 layout.tsx 里那段首帧内联脚本的**源文本**——它必须是同步内联的
//（异步就会先闪一帧另一套配色），因而没法用常规方式调用，只能对文本下手。
// 这与 scripts/ci-workflow.test.mjs 断言 ci.yml 文本是同一套办法。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const layout = fs.readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
// 只取内联脚本那一行，避免把注释里的字样也算进来
const inlineScript = layout
  .split("\n")
  .find((l) => l.includes("dangerouslySetInnerHTML") === false && l.includes("localStorage.getItem('fencun-theme')"));

test("默认主题：首帧内联脚本存在且是同步的", () => {
  assert.ok(inlineScript, "找不到设置 data-theme 的首帧内联脚本");
  assert.ok(layout.includes("dangerouslySetInnerHTML"), "内联脚本必须同步注入，否则会闪一帧错的配色");
});

test("默认主题：不按时段翻，也不读系统深浅色", () => {
  assert.ok(!inlineScript!.includes("getHours"), "内联脚本又按小时判断主题了——页面开着跨过 18:00 会当着用户面自己翻");
  assert.ok(!inlineScript!.includes("prefers-color-scheme"), "内联脚本读了系统深浅色偏好");
  // 全站唯一允许出现的时段逻辑是 daypartFromHour（推荐情境的日夜，决定「今夜之选」眉标
  // 与偏夜香的加权），它和视觉主题是两件事，不得再耦合回去。
  const providerSrc = fs.readFileSync(path.join(process.cwd(), "src/components/AppProvider.tsx"), "utf8");
  const themeAssignLines = providerSrc
    .split("\n")
    // `=(?!=)` 才是赋值——不加负向前瞻会把 theme-color 同步里的 `dataset.theme === "night"` 也算进来
    .filter((l) => /dataset\.theme\s*=(?!=)/.test(l) && !l.trimStart().startsWith("//"));
  assert.deepEqual(themeAssignLines, [], `AppProvider 不该再改写主题：${JSON.stringify(themeAssignLines)}`);
});

test("默认主题：无存储偏好时落明韵，只有显式 'night' 才是暗香", () => {
  // 复刻内联脚本的判定，确保它对三种输入的行为都是我们要的
  const decide = (saved: string | null) => (saved === "night" ? "night" : "day");
  assert.equal(decide(null), "day", "没存过偏好就该是明韵");
  assert.equal(decide("day"), "day");
  assert.equal(decide("night"), "night", "用户切过暗香就要记住");
  assert.equal(decide("garbage"), "day", "脏值必须落回默认，不能变成暗香");
  // 内联脚本必须就是这个判定：三元里只认 'night'
  assert.match(inlineScript!, /fencun-theme'\)\s*===\s*'night'\s*\?\s*'night'\s*:\s*'day'/);
});
