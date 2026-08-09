// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

import type { MetadataRoute } from "next";
import { SITE_URL } from "./layout";

// 四个页面就是全部可索引内容——香柜/香历/画像的**数据**都在用户本机，
// 服务端渲染出来的只有骨架，所以这里不存在"每瓶香水一个 URL"那种站点地图。
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/library`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/journal`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/profile`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
