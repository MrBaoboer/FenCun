// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

// 404：Next 的内置页是英文的「404 / This page could not be found.」，
// 对一个把分享门面（og / manifest / icon 全自制）当卖点的中文产品，那是一张没被接管的界面。
//
// 更实际的一条：内置页会往文档里注入一段**无 layer** 的 `body{color:#000;background:#fff}`
// 与 `@media (prefers-color-scheme:dark)` 覆盖。按 CSS 级联，无 layer 规则无条件压过
// layered 规则（与文档顺序无关），而站点底色写在 globals.css 的 `@layer base` 里，
// 且氛寸的主题是 data-theme 驱动、默认恒为明韵、明确不跟系统深浅色。
// 于是系统开着深色的访客在任何一个坏链接上会看到「浅色头部导航 + 纯黑页面底色」。
// 只要这个文件存在，Next 就不再注入那段样式——这才是它值得动手的真正理由。
import Link from "next/link";

export const metadata = { title: "没找到这一页 · 氛寸" };

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card w-full max-w-md px-6 py-12 text-center">
        <div className="eyebrow eyebrow-mute">走岔了 · Not Found</div>
        <h1 className="serif mt-3 text-[1.4rem] font-bold leading-snug text-ink">
          这一页不在氛寸里
        </h1>
        <p className="serif mx-auto mt-2.5 max-w-xs text-[0.9rem] leading-relaxed text-ink-soft">
          链接可能过期了。
        </p>
        <Link href="/" className="btn-primary mt-6 inline-block px-6 py-3 text-[0.9rem]">
          回今日之选
        </Link>
      </div>
    </div>
  );
}
