"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useStore } from "./store";
import { seasonFromDateTemp, feelFromWeather, daypartFromHour } from "./season";
import { recommend, aggregateBias } from "./recommend";
import { DISTANCE_LABEL } from "./format";
import type { Context, Perfume, ScoredPick } from "./types";

// 实时情境（天气 + 季节/体感/时段 + 场景）
export function useResolvedContext(): Context | null {
  const { weather } = useApp();
  const occasion = useStore((s) => s.occasion);
  return useMemo(() => {
    if (!weather) return null;
    const now = new Date();
    return {
      tempC: weather.tempC,
      humidity: weather.humidity,
      windSpeed: weather.windSpeed,
      weatherText: weather.text,
      city: weather.city,
      feel: feelFromWeather(weather.tempC, weather.humidity),
      daypart: daypartFromHour(now.getHours()),
      season: seasonFromDateTemp(now, weather.tempC),
      occasion,
      approximate: weather.approximate,
    };
  }, [weather, occasion]);
}

// 用户库内的香水对象
export function useLibraryPerfumes(): Perfume[] {
  const { catalog } = useApp();
  const userPerfumes = useStore((s) => s.userPerfumes);
  return useMemo(() => {
    if (!catalog) return [];
    const byId = new Map(catalog.map((p) => [p.id, p]));
    return userPerfumes.map((u) => byId.get(u.perfumeId)).filter(Boolean) as Perfume[];
  }, [catalog, userPerfumes]);
}

// 推荐
export function useRecommendation(ctx: Context | null) {
  const lib = useLibraryPerfumes();
  const feedbacks = useStore((s) => s.feedbacks);
  return useMemo(() => {
    if (!ctx || lib.length === 0) return null;
    const bias = aggregateBias(feedbacks);
    return recommend(lib, ctx, bias);
  }, [lib, ctx, feedbacks]);
}

// 客户端解释缓存（模块级，跨组件/重渲染持久）——命中即不发请求
const explainCache = new Map<string, { text: string; source: "deepseek" | "template" }>();

// DeepSeek 解释（防抖 + 缓存，避免连点场合/换瓶就频繁调用）
export function useExplain(pick: ScoredPick | null, ctx: Context | null) {
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<"deepseek" | "template" | "">("");
  const reqId = useRef(0);

  const key =
    pick && ctx
      ? `${pick.perfume.id}-${ctx.occasion}-${Math.round(ctx.tempC)}-${pick.verdict}`
      : "";

  useEffect(() => {
    if (!pick || !ctx) {
      setText("");
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
