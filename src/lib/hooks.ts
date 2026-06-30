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

// DeepSeek 解释（带兜底，pick/ctx 变化时重取）
export function useExplain(pick: ScoredPick | null, ctx: Context | null) {
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<"deepseek" | "template" | "">("");
  const reqId = useRef(0);

  const key = pick && ctx ? `${pick.perfume.id}-${ctx.occasion}-${Math.round(ctx.tempC)}` : "";

  useEffect(() => {
    if (!pick || !ctx) {
      setText("");
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    setText(pick.reasons[0] ?? "");
    fetch("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: pick.perfume.nameZh || pick.perfume.name,
        brandZh: pick.perfume.brandZh,
        accords: pick.perfume.accords.slice(0, 4).map((a) => a.zh),
        styleTags: pick.perfume.styleTags,
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
        }
      })
      .catch(() => {})
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { text, loading, source };
}
