"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { dayFloor } from "@/lib/recommend";
import { wearEntryFrom } from "@/lib/journal";
import { Eyebrow } from "@/components/ui";
import type { Context, Perfume } from "@/lib/types";

const OPTIONS: { key: "too_weak" | "perfect" | "too_strong" | "scene_mismatch"; label: string; done: string }[] = [
  { key: "too_weak", label: "淡了点", done: "记下了，下次帮你略微多喷一点。" },
  { key: "perfect", label: "刚好", done: "记住这个配置了——下次同样的天气和场合，直接照它来。" },
  { key: "too_strong", label: "太冲了", done: "记下了，下次默认帮你少喷半下。" },
  { key: "scene_mismatch", label: "不合场合", done: "记下了。这类场合，下次会先想到别瓶。" },
];

// 环境归因：高温/闷湿天的"淡了"是天气吃掉了留香，不该记成这瓶的喷量问题
function envEatsLongevity(ctx: Context): boolean {
  return ctx.feel === "hot_humid" || ctx.feel === "hot_dry" || ctx.tempC >= 28;
}

export function FeedbackBar({
  perfume,
  ctx,
  sprays,
}: {
  perfume: Perfume;
  ctx: Context;
  sprays?: [number, number];
}) {
  const perfumeId = perfume.id;
  const addFeedback = useStore((s) => s.addFeedback);
  const markWorn = useStore((s) => s.markWorn);
  const logWear = useStore((s) => s.logWear);
  // 当日去重：今天已经记过这瓶 → 不再重复问（刷新页面也不会重复计入）
  const fedToday = useStore((s) =>
    s.feedbacks.some((f) => f.perfumeId === perfumeId && dayFloor(f.at) === dayFloor(Date.now()))
  );
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => setDone(null), [perfumeId]);

  function submit(o: (typeof OPTIONS)[number]) {
    const envAttributed = o.key === "too_weak" && envEatsLongevity(ctx);
    addFeedback({
      perfumeId,
      at: Date.now(),
      context: {
        season: ctx.season,
        daypart: ctx.daypart,
        tempC: ctx.tempC,
        occasion: ctx.occasion,
        feel: ctx.feel,
        humidity: ctx.humidity,
      },
      rating: o.key,
      sprays,
      tags: envAttributed ? ["env_attributed"] : undefined,
    });
    markWorn(perfumeId);
    logWear(wearEntryFrom(perfume, ctx)); // 反馈即穿过——今天这瓶落进香历
    setDone(
      envAttributed
        ? "记下了——不过今天这天气本来就吃留香，这笔算天气的，不扣它的分。"
        : o.done
    );
  }

  if (fedToday && !done) {
    return (
      <div className="card px-5 py-4">
        <p className="serif text-[0.9rem] text-ink-faint">今天这瓶已经记过了。明天见。</p>
      </div>
    );
  }

  return (
    <div className="card px-5 py-4">
      {done ? (
        <p className="serif animate-fade-in text-[0.95rem] font-medium text-ink-soft">{done}</p>
      ) : (
        <>
          <Eyebrow>今天，刚好吗</Eyebrow>
          <div className="mt-3.5 grid grid-cols-2 gap-2.5">
            {OPTIONS.map((o) => (
              <button
                key={o.key}
                onClick={() => submit(o)}
                className="chip serif py-2.5 text-[0.9rem] hover:text-ink"
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
