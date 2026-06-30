"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Eyebrow } from "@/components/ui";
import type { Context } from "@/lib/types";

const OPTIONS: { key: "too_weak" | "perfect" | "too_strong"; label: string; done: string }[] = [
  { key: "too_weak", label: "淡了点", done: "记下了，下次帮你略微多喷一点。" },
  { key: "perfect", label: "刚好", done: "太好了，记下你的「刚好」。" },
  { key: "too_strong", label: "太冲了", done: "记下了，下次默认帮你少喷半下。" },
];

export function FeedbackBar({ perfumeId, ctx }: { perfumeId: number; ctx: Context }) {
  const addFeedback = useStore((s) => s.addFeedback);
  const markWorn = useStore((s) => s.markWorn);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => setDone(null), [perfumeId]);

  function submit(o: (typeof OPTIONS)[number]) {
    addFeedback({
      perfumeId,
      at: Date.now(),
      context: { season: ctx.season, daypart: ctx.daypart, tempC: ctx.tempC, occasion: ctx.occasion },
      rating: o.key,
    });
    markWorn(perfumeId);
    setDone(o.done);
  }

  return (
    <div className="card px-5 py-4">
      {done ? (
        <p className="animate-fade-in text-sm text-ink-soft">{done}</p>
      ) : (
        <>
          <Eyebrow>今天，刚好吗</Eyebrow>
          <div className="mt-3 flex gap-2">
            {OPTIONS.map((o) => (
              <button
                key={o.key}
                onClick={() => submit(o)}
                className="chip flex-1 py-2 text-sm hover:border-brand-soft hover:text-ink"
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
