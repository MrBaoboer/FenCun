// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

import type { MetadataRoute } from "next";
import { SITE_URL } from "./layout";

// 全站可抓。三条 API 路由排除在外：它们不是内容页，被抓只会白白消耗上游配额
//（/api/context 打和风、/api/explain 打 DeepSeek），而且返回值依赖请求参数，对搜索没有意义。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
