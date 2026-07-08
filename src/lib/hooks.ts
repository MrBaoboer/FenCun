"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useStore } from "./store";
import { seasonFromDateTemp, feelFromWeather, daypartFromHour } from "./season";
import { recommend, buildPick, aggregateBias, dayFloor } from "./recommend";
import { DISTANCE_LABEL } from "./format";
import type { Context, Perfume, ScoredPick } from "./types";

// 发现型钩子（S4 天气突变预警 / S5 吃灰提醒）
export type Nudge =
  | { kind: "dusty"; perfume: Perfume; days: number; pick: ScoredPick }
  | { kind: "weather"; habitual: Perfume; better: Perfume | null; reason: string; basis: "habit" | "cold" };

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
      notePreference: scene?.notePreference,
      tension: scene?.tension,
      duration: scene?.duration,
      meal: scene?.meal,
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
    const daySeed = Math.floor(dayFloor(Date.now()) / DAY_MS);
    const lastWornAt = new Map(
      userPerfumes.filter((u) => u.lastWornAt != null).map((u) => [u.perfumeId, u.lastWornAt!])
    );
    const swapMap = new Map(Object.entries(swapAways).map(([k, v]) => [Number(k), v]));
    return recommend(lib, ctx, bias, { daySeed, lastWornAt, swapAways: swapMap });
  }, [lib, ctx, feedbacks, userPerfumes, swapAways]);
}

const DAY_MS = 24 * 3600 * 1000;
export const DUSTY_MS = 21 * DAY_MS; // 用过但很久没碰（全应用统一口径：吃灰=21 天）
const NEVER_MS = 14 * DAY_MS; // 从没用过、入柜超两周

// 发现型钩子：吃灰提醒(S5) + 天气突变预警(S4)——传播主线
export function useNudges(ctx: Context | null, rec: RecResult | null): Nudge[] {
  const lib = useLibraryPerfumes();
  const userPerfumes = useStore((s) => s.userPerfumes);
  const feedbacks = useStore((s) => s.feedbacks);

  return useMemo(() => {
    if (!ctx || !rec) return [];
    const now = Date.now();
    const bias = aggregateBias(feedbacks);
    const primaryId = rec.primary?.perfume.id;
    const byId = new Map(lib.map((p) => [p.id, p]));
    const uById = new Map(userPerfumes.map((u) => [u.perfumeId, u]));
    const hasHistory = feedbacks.length >= 2; // 已有用香习惯
    const nudges: Nudge[] = [];

    // S5 吃灰提醒：搁置已久、但今天恰好合适(verdict good)、且不是今天的主推
    const dusty = lib
      .filter((p) => {
        const u = uById.get(p.id);
        if (!u) return false;
        if (u.lastWornAt) return now - u.lastWornAt > DUSTY_MS;
        // 从没用过：入柜超两周；或已有用香习惯却独独没碰它、入柜超 3 天（冷启动更早触发）
        return now - u.addedAt > NEVER_MS || (hasHistory && now - u.addedAt > 3 * DAY_MS);
      })
      .map((p) => {
        const u = uById.get(p.id)!;
        return { p, u, pick: buildPick(p, ctx, bias.get(p.id)) };
      })
      .filter((x) => x.pick.verdict === "good" && x.p.id !== primaryId)
      .sort((a, b) => b.pick.score - a.pick.score);

    if (dusty[0]) {
      const { p, u, pick } = dusty[0];
      const last = u.lastWornAt ?? u.addedAt;
      nudges.push({ kind: "dusty", perfume: p, days: Math.round((now - last) / DAY_MS), pick });
    }

    // S4 天气突变预警：依赖真实天气——近似天气态(定位失败降级)下不弹，避免用人造体感冒充"天气突变预警"
    if (!ctx.approximate) {
      // "常喷"用真实穿戴信号 wornCount(换香/吃灰采纳/反馈提交累计≥2次，同日去重)，而非反馈计数——feedback 稀疏、口径失真
      let habitualId: number | null = null;
      let maxWorn = 1;
      for (const u of userPerfumes) {
        const c = u.wornCount ?? 0;
        if (c > maxWorn && byId.has(u.perfumeId)) {
          maxWorn = c;
          habitualId = u.perfumeId;
        }
      }
      let basis: "habit" | "cold" = habitualId != null ? "habit" : "cold";
      // 冷启动兜底：还没形成用香习惯时，退回"库里今天最相关、却被判 avoid 的那瓶"——让旗舰钩子第一周不哑火
      if (habitualId == null) {
        const flagged = rec.ranked.find((r) => r.verdict === "avoid" && r.perfume.id !== primaryId);
        if (flagged) {
          habitualId = flagged.perfume.id;
          basis = "cold"; // 不是"常喷"，只是今天库里被判不宜的一瓶 → 文案不能冒称个性化
        }
      }
      if (habitualId != null && habitualId !== primaryId) {
        const hp = buildPick(byId.get(habitualId)!, ctx, bias.get(habitualId));
        if (hp.verdict === "avoid") {
          const better = rec.ranked.find((r) => r.verdict === "good" && r.perfume.id !== habitualId)?.perfume ?? null;
          nudges.push({
            kind: "weather",
            habitual: byId.get(habitualId)!,
            better,
            reason: hp.risks[0] || "今天的天气不太适合它",
            basis,
          });
        }
      }
    }

    return nudges;
  }, [ctx, rec, lib, userPerfumes, feedbacks]);
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
      ? `${pick.perfume.id}-${ctx.occasion}-${Math.round(ctx.tempC)}-${pick.verdict}-${ctx.sceneLabel ?? ""}-${pick.usage.spraysLabel}`
      : "";

  useEffect(() => {
    if (!pick || !ctx) {
      setText("");
      setLoading(false);
      return;
    }
    // 无天气降级：不调 DeepSeek（避免臆造天气），直接用规则要点
    if (ctx.approximate) {
      setText(pick.reasons.join("，") + "。");
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
