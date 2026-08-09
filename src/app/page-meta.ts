// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

import type { Metadata } from "next";

/**
 * 内页 metadata 工厂。
 *
 * ⚠️ Next 的 metadata 合并对 `openGraph` 是**整体替换**，不是逐字段继承：内页只写了
 * title/description/url，根 layout 里的 images / type / siteName / locale 就全部消失。
 * 而 `twitter` 因为内页没写，反倒原样继承了根的那份——于是同一张 /library 上
 * og:title 说「香柜 · 氛寸」、twitter:title 说「氛寸 · 帮你用好香水」，互相打架，
 * 分享到微信/Facebook/LinkedIn 出来的是一张没有图的卡。
 * 线上 curl 四页逐条比对确认过：三个内页的 og:image / og:type / og:site_name 全丢。
 *
 * 所以内页不再手写这两块，一律从这里出——补全的字段只有一处定义，不会再各写一遍再漂移。
 */
export function pageMetadata(opts: {
  title: string;
  description: string;
  path: `/${string}`;
}): Metadata {
  const { title, description, path } = opts;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "zh_CN",
      siteName: "氛寸",
      title,
      description,
      url: path,
      images: [{ url: "/og.png", width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}
