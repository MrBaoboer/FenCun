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
  { key: "scene_mismatch", label: "不合场合", done: "记下了。这类场合，下次先想到的不会是它。" },
];

// 环境归因：高温/闷湿天的"淡了"是天气吃掉了留香，不该记成这瓶的喷量问题
function envEatsLongevity(ctx: Context): boolean {
  return ctx.feel === "hot_humid" || ctx.feel === "hot_dry" || ctx.tempC >= 28;
}

// 嗅觉适应归因：连着几天用同一瓶，最先失灵的是你自己的鼻子，不是这瓶香。
// 依据【实证·中，领域规则手册里证据最硬的一条】：嗅觉适应是双通路的真实生理现象——外周通路数十秒起效，
// 嗅球通路数分钟起效并可持续 30 分钟以上；更关键的是，**重复暴露于同一款气味
// 会造成持续数周的、气味特异性的敏感度下降**。
// 所以"连着穿同一瓶的人说它淡了"是所有反馈里最容易被误读的一条：
// 把它换算成"多喷一点"，就是在一个已经失真的信号上加杠杆——用户闻不到 → 多喷 →
// 适应更深 → 还是闻不到 → 再多喷，而周围人闻到的浓度一路上升。
// 这也是氛寸最值得说出口的一条洞察："你闻不到，不代表别人闻不到。"
function recentlyRepeated(wearLog: { d: string; perfumeId: number }[], perfumeId: number): boolean {
  const day = 24 * 3600 * 1000;
  const keys = [0, 1, 2].map((i) => {
    const t = new Date(Date.now() - i * day);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  });
  return wearLog.filter((e) => e.perfumeId === perfumeId && keys.includes(e.d)).length >= 2;
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
  const wearLog = useStore((s) => s.wearLog);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => setDone(null), [perfumeId]);

  function submit(o: (typeof OPTIONS)[number]) {
    // 归因顺序：先看嗅觉适应（证据更硬，且是"闻不到 ≠ 没味道"这条洞察的落点），
    // 再看天气吃留香。两者都指向同一个结论：这笔不该记成"该多喷"。
    const adaptAttributed = o.key === "too_weak" && recentlyRepeated(wearLog, perfumeId);
    const envAttributed = o.key === "too_weak" && !adaptAttributed && envEatsLongevity(ctx);
    const tags: string[] = [];
    if (adaptAttributed) tags.push("adaptation_attributed");
    if (envAttributed) tags.push("env_attributed");
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
      tags: tags.length ? tags : undefined,
    });
    markWorn(perfumeId);
    logWear(wearEntryFrom(perfume, ctx)); // 反馈即穿过——今天这瓶落进香历
    setDone(
      adaptAttributed
        ? "这几天你连着用了它——最先「失灵」的多半是鼻子，不是香水。你闻不到，旁边的人未必。这笔先不加喷量；明天换一瓶，隔两天再回来闻它。"
        : envAttributed
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
