// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useStore } from "./store";
import { seasonFromDateTemp, feelFromWeather, daypartFromHour } from "./season";
import { recommend, aggregateBias, dayFloor } from "./recommend";
import { pickNudges, type Nudge } from "./nudges";
import { DISTANCE_LABEL } from "./format";
import type { Context, Perfume, ScoredPick } from "./types";

// Nudge 的类型与计算都在 lib/nudges.ts。这里转出，免得消费方为一个类型跨两个文件。
export type { Nudge } from "./nudges";
export { DUSTY_MS } from "./nudges";

type RecResult = ReturnType<typeof recommend>;

// 实时情境（天气 + 季节/体感/时段 + 场景）
export function useResolvedContext(): Context | null {
  const { weather, locState, nowMinute } = useApp();
  const occasion = useStore((s) => s.occasion);
  const scene = useStore((s) => s.scene);
  return useMemo(() => {
    // 用 AppProvider 的分钟级节拍作时钟源：长开标签页跨时段/跨午夜时，daypart/季节/问候随之刷新
    const now = new Date(nowMinute);
    // 场景补丁（自然语言优先于 chip）
    const sceneFields = {
      occasion: scene?.occasion ?? occasion,
      formality: scene?.formality,
      intimacy: scene?.intimacy,
      avoid: scene?.avoid,
      tension: scene?.tension,
      duration: scene?.duration,
      meal: scene?.meal,
      fragranceFree: scene?.fragranceFree,
      riskNote: scene?.riskNote,
      sceneLabel: scene?.label,
      rawText: scene?.rawText,
    };
    if (weather) {
      return {
        tempC: weather.tempC,
        humidity: weather.humidity,
        windSpeed: weather.windSpeed,
        weatherText: weather.text,
        city: weather.city,
        feel: feelFromWeather(weather.tempC, weather.humidity),
        daypart: daypartFromHour(now.getHours()),
        season: seasonFromDateTemp(now, weather.tempC),
        ...sceneFields,
        approximate: weather.approximate,
      };
    }
    // 拿不到天气（拒绝定位/失败）→ 季节+时段降级情境，仍能推荐（不再死路）；still locating 时返回 null
    if (locState === "denied" || locState === "error") {
      const season = seasonFromDateTemp(now, null);
      const seasonalTemp = season === "summer" ? 27 : season === "winter" ? 6 : season === "spring" ? 18 : 16;
      return {
        // 季节代表温度：feel 保持 mild（不触发闷热/寒凉的强规则），但盛夏/隆冬的代表温度会让
        // 天气乘子按 mild 段梯度产生 ±5% 的季节性倾斜（夏奖清爽、冬奖暖香）——这是刻意保留的行为：
        // 降级时我们确实知道季节；不冒充的是"实时天气"（approximate 态不弹天气预警、不调 LLM）
        tempC: seasonalTemp,
        humidity: 50,
        windSpeed: 0,
        weatherText: "",
        city: "",
        feel: "mild",
        daypart: daypartFromHour(now.getHours()),
        season,
        ...sceneFields,
        approximate: true,
      };
    }
    return null;
  }, [weather, locState, occasion, scene, nowMinute]);
}

// 用户库内的香水对象：主目录 ∪ 扩展集快照 ∪ 手动记录（三层数据分层，柜里的每一瓶都能被找到）
export function useLibraryPerfumes(): Perfume[] {
  const { catalog } = useApp();
  const userPerfumes = useStore((s) => s.userPerfumes);
  const extPerfumes = useStore((s) => s.extPerfumes);
  const customPerfumes = useStore((s) => s.customPerfumes);
  return useMemo(() => {
    const byId = new Map((catalog ?? []).map((p) => [p.id, p]));
    for (const p of extPerfumes) if (!byId.has(p.id)) byId.set(p.id, p);
    for (const p of customPerfumes) if (!byId.has(p.id)) byId.set(p.id, p);
    return userPerfumes.map((u) => byId.get(u.perfumeId)).filter(Boolean) as Perfume[];
  }, [catalog, userPerfumes, extPerfumes, customPerfumes]);
}

// 推荐
export function useRecommendation(ctx: Context | null) {
  const lib = useLibraryPerfumes();
  const feedbacks = useStore((s) => s.feedbacks);
  const userPerfumes = useStore((s) => s.userPerfumes);
  const swapAways = useStore((s) => s.swapAways);
  return useMemo(() => {
    if (!ctx || lib.length === 0) return null;
    const bias = aggregateBias(feedbacks);
    // 本地日历日做轮换种子：跨天在本地零点切换，而不是 UTC 零点（北京早上 8 点）——
    // "今日推荐"不能在"今天"进行到 1/3 时换答案
    const daySeed = Math.floor(dayFloor(Date.now()) / (24 * 3600 * 1000));
    const lastWornAt = new Map(
      userPerfumes.filter((u) => u.lastWornAt != null).map((u) => [u.perfumeId, u.lastWornAt!])
    );
    const swapMap = new Map(Object.entries(swapAways).map(([k, v]) => [Number(k), v]));
    return recommend(lib, ctx, bias, { daySeed, lastWornAt, swapAways: swapMap });
  }, [lib, ctx, feedbacks, userPerfumes, swapAways]);
}


// 发现型钩子：吃灰提醒(S5) + 天气突变预警(S4)——传播主线。
// 计算本身在 lib/nudges.ts（纯函数、now 是入参、可单测），这里只做订阅与记忆化。
// now 取 AppProvider 的分钟节拍而不是 Date.now()：既让这段 memo 对依赖保持纯，
// 也让长开的标签页跨过 21 天吃灰线时自己刷新，而不是冻结在打开那一刻。
export function useNudges(ctx: Context | null, rec: RecResult | null): Nudge[] {
  const lib = useLibraryPerfumes();
  const userPerfumes = useStore((s) => s.userPerfumes);
  const feedbacks = useStore((s) => s.feedbacks);
  const { nowMinute } = useApp();

  return useMemo(
    () => (ctx && rec ? pickNudges({ lib, userPerfumes, feedbacks, ctx, rec, now: nowMinute }) : []),
    [ctx, rec, lib, userPerfumes, feedbacks, nowMinute]
  );
}

// 客户端解释缓存（模块级，跨组件/重渲染持久）——命中即不发请求
const explainCache = new Map<string, { text: string; source: "deepseek" | "template" }>();

// DeepSeek 解释（防抖 + 缓存，避免连点场合/换瓶就频繁调用）
export function useExplain(pick: ScoredPick | null, ctx: Context | null) {
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<"deepseek" | "template" | "">("");
  const reqId = useRef(0);

  // 缓存键的判据只有一条：**凡是会进请求体、又可能被复述进正文的字段，都必须在键里**。
  // 此前漏了 city / weatherText / feel / daypart——切了城市而整数温度没变，
  // 情境卡显示「上海 · 阴 · 31°」，紧挨着的金边解读仍写「今天北京晴、31℃」，
  // 首屏两个相邻元素直接打架。feel 也不能漏：usage.ts 的 weatherWord
  //（「又热又潮」vs「这么热」）随它变，并作为风险文案进正文。
  // 不给这个 Map 加淘汰策略：一次会话里的键被主推瓶 × 8 个场合 × 少数几个整数温度限死，
  // 是几十条量级，加 LRU 属于反过度设计。
  const key =
    pick && ctx
      ? [
          pick.perfume.id,
          ctx.city,
          ctx.occasion,
          Math.round(ctx.tempC),
          ctx.weatherText,
          ctx.feel,
          ctx.daypart,
          pick.verdict,
          ctx.sceneLabel ?? "",
          pick.usage.spraysLabel,
        ].join("-")
      : "";

  useEffect(() => {
    if (!pick || !ctx) {
      setText("");
      setLoading(false);
      return;
    }
    // 无香场合：绝不交给 LLM。SYSTEM 里对 avoid 的铁律要求它话锋一转给出
    // "但你今天要是就想用它，可以这样把影响降到最低…"——那套措辞对约会、通勤是对的，
    // 对病房是错的。这里没有"降到最低"的版本，只有"别用"。规则文案直接输出，不留软化的余地。
    if (pick.usage.sprays[1] === 0) {
      setText(pick.risks[0] ?? "今天这个场合，把香水留在家里更稳妥。");
      setSource("template");
      setLoading(false);
      return;
    }
    // 无天气降级：不调 DeepSeek（避免臆造天气），直接用规则要点
    if (ctx.approximate) {
      setText(pick.reasons.map((r) => r.replace(/。$/, "")).join("，") + "。");
      setSource("template");
      setLoading(false);
      return;
    }
    // 命中缓存：立即返回，不触发网络请求
    const cached = explainCache.get(key);
    if (cached) {
      setText(cached.text);
      setSource(cached.source);
      setLoading(false);
      return;
    }

    const id = ++reqId.current;
    setText(pick.reasons[0] ?? "");
    setLoading(true);

    // 防抖：等 550ms 内无新变化才真正请求（连点场合/换瓶只发最后一次）
    const timer = setTimeout(() => {
      fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: pick.perfume.nameZh || pick.perfume.name,
          brandZh: pick.perfume.brandZh,
          accords: pick.perfume.accords.slice(0, 4).map((a) => a.zh),
          styleTags: pick.perfume.styleTags,
          verdict: pick.verdict,
          scene: ctx.sceneLabel ? { label: ctx.sceneLabel, rawText: ctx.rawText } : null,
          context: {
            city: ctx.city,
            tempC: ctx.tempC,
            humidity: ctx.humidity,
            weatherText: ctx.weatherText,
            feel: ctx.feel,
            season: ctx.season,
            daypart: ctx.daypart,
            occasion: ctx.occasion,
          },
          usage: {
            spraysLabel: pick.usage.spraysLabel,
            placement: pick.usage.placement,
            distance: DISTANCE_LABEL[pick.usage.socialDistance],
            durationHint: pick.usage.durationHint,
          },
          reasons: pick.reasons,
          risks: pick.risks,
        }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (id !== reqId.current) return;
          if (d.text) {
            setText(d.text);
            setSource(d.source ?? "template");
            explainCache.set(key, { text: d.text, source: d.source ?? "template" });
          }
        })
        .catch(() => {})
        .finally(() => {
          if (id === reqId.current) setLoading(false);
        });
    }, 550);

    return () => clearTimeout(timer); // key 变化 → 取消上一次待发请求（防抖核心）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { text, loading, source };
}
