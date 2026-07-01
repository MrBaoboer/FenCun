"use client";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import {
  useResolvedContext,
  useRecommendation,
  useLibraryPerfumes,
  useExplain,
  useNudges,
} from "@/lib/hooks";
import { buildPick, aggregateBias } from "@/lib/recommend";
import { ContextBar } from "@/components/today/ContextBar";
import { NudgeCard } from "@/components/today/NudgeCard";
import { RecommendationCard } from "@/components/today/RecommendationCard";
import { AltList } from "@/components/today/AltList";
import { FeedbackBar } from "@/components/today/FeedbackBar";
import { ChangeBottleSheet } from "@/components/today/ChangeBottleSheet";
import { EmptyShelf } from "@/components/today/EmptyShelf";

export default function TodayPage() {
  const ctx = useResolvedContext();
  const rec = useRecommendation(ctx);
  const lib = useLibraryPerfumes();
  const feedbacks = useStore((s) => s.feedbacks);
  const hydrated = useStore((s) => s.hydrated);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const bias = useMemo(() => aggregateBias(feedbacks), [feedbacks]);

  const activePick = useMemo(() => {
    if (!ctx) return null;
    if (selectedId != null) {
      const p = lib.find((x) => x.id === selectedId);
      if (p) return buildPick(p, ctx, bias.get(p.id));
    }
    return rec?.primary ?? null;
  }, [selectedId, lib, ctx, rec, bias]);

  const isSelected = !!(
    selectedId != null &&
    activePick &&
    rec?.primary &&
    activePick.perfume.id !== rec.primary.perfume.id
  );

  const explain = useExplain(activePick, ctx);
  const nudges = useNudges(ctx, rec);

  return (
    <div className="flex flex-col gap-5">
      <ContextBar ctx={ctx} />

      {hydrated && lib.length > 0 && ctx && nudges.length > 0 && (
        <div className="flex flex-col gap-3">
          {nudges.map((n, i) => (
            <NudgeCard key={i} nudge={n} onPick={(id) => setSelectedId(id)} />
          ))}
        </div>
      )}

      {!hydrated ? (
        <div className="h-56 animate-pulse bg-sunken/50" />
      ) : lib.length === 0 ? (
        <EmptyShelf />
      ) : !ctx ? (
        <p className="px-1 text-sm leading-relaxed text-ink-faint">
          等你的此刻天气到位，氛寸就为你从香柜里挑一瓶。
        </p>
      ) : activePick ? (
        <>
          <RecommendationCard
            pick={activePick}
            ctx={ctx}
            isSelected={isSelected}
            explainText={explain.text}
            explainLoading={explain.loading}
            explainSource={explain.source}
            onChangeBottle={() => setSheetOpen(true)}
            onReset={() => setSelectedId(null)}
          />
          <AltList alts={rec?.alternatives ?? []} onPick={(id) => setSelectedId(id)} />
          <FeedbackBar perfumeId={activePick.perfume.id} ctx={ctx} />
        </>
      ) : null}

      <ChangeBottleSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        perfumes={lib}
        currentId={activePick?.perfume.id ?? null}
        onSelect={(id) => setSelectedId(id)}
      />
    </div>
  );
}
