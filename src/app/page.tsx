"use client";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { useApp } from "@/components/AppProvider";
import {
  useResolvedContext,
  useRecommendation,
  useLibraryPerfumes,
  useExplain,
  useNudges,
} from "@/lib/hooks";
import { buildPick, aggregateBias } from "@/lib/recommend";
import { wearEntryFrom } from "@/lib/journal";
import type { ScoredPick } from "@/lib/types";
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
  const userPerfumes = useStore((s) => s.userPerfumes);
  const markWorn = useStore((s) => s.markWorn);
  const logWear = useStore((s) => s.logWear);
  const recordSwap = useStore((s) => s.recordSwap);
  const recordDustyAdopt = useStore((s) => s.recordDustyAdopt);
  const hydrated = useStore((s) => s.hydrated);
  const { catalog, catalogError, retryCatalog } = useApp();

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

  // 备选列表随当前展示瓶重算：换瓶后剔除所选瓶自身、并把被顶掉的自动首选纳回，避免"主推A也可以考虑A"、自动首选凭空消失
  const altsToShow = useMemo<ScoredPick[]>(() => {
    if (!rec) return [];
    if (!isSelected || !activePick) return rec.alternatives;
    const out: ScoredPick[] = [];
    if (rec.primary && rec.primary.perfume.id !== activePick.perfume.id) out.push(rec.primary);
    for (const pk of rec.ranked) {
      if (out.length >= 3) break;
      if (pk.perfume.id === activePick.perfume.id) continue;
      if (out.some((o) => o.perfume.id === pk.perfume.id)) continue;
      out.push(pk);
    }
    return out.slice(0, 3);
  }, [rec, isSelected, activePick]);

  // 采纳一瓶（换香/翻出吃灰瓶）→ 记穿戴 + 香历落账 + 打点证伪指标；
  // 把主推换掉同时记一笔"隐式差评"（分数说它行、你说它不行——7 天内两次就让它让位）
  const adopt = (id: number, kind: "swap" | "dusty") => {
    setSelectedId(id);
    markWorn(id);
    const p = lib.find((x) => x.id === id);
    if (p && ctx) logWear(wearEntryFrom(p, ctx));
    if (kind === "dusty") recordDustyAdopt();
    else if (kind === "swap" && rec?.primary && id !== rec.primary.perfume.id)
      recordSwap(rec.primary.perfume.id);
  };

  const explain = useExplain(activePick, ctx);
  const nudges = useNudges(ctx, rec);

  return (
    <div className="flex flex-col gap-5">
      <ContextBar ctx={ctx} />

      {hydrated && lib.length > 0 && ctx && nudges.length > 0 && (
        <div className="flex flex-col gap-3">
          {nudges.map((n, i) => (
            <NudgeCard
              key={i}
              nudge={n}
              onPick={(id) => adopt(id, n.kind === "dusty" ? "dusty" : "swap")}
            />
          ))}
        </div>
      )}

      {!hydrated ? (
        <div className="h-56 animate-pulse bg-sunken/50" />
      ) : catalogError && userPerfumes.length > 0 ? (
        <CatalogError count={userPerfumes.length} onRetry={retryCatalog} />
      ) : catalog === null && !catalogError ? (
        // 目录还在加载：继续骨架屏——满柜用户在这个窗口期不该看到"空柜"（那句话对他们是假的）
        <div className="h-56 animate-pulse bg-sunken/50" />
      ) : lib.length === 0 ? (
        <EmptyShelf />
      ) : !ctx ? (
        <p className="serif px-1 text-[0.82rem] leading-relaxed text-ink-faint">
          等你的此刻天气到位，氛寸就为你从香柜里挑一瓶。
        </p>
      ) : activePick ? (
        <>
          {ctx.approximate && (
            <p className="serif px-1 text-[0.82rem] leading-relaxed text-ink-faint">
              还没拿到天气，先按季节 · 时段为你推荐；上方填一下城市会更准。
            </p>
          )}
          <RecommendationCard
            pick={activePick}
            ctx={ctx}
            isSelected={isSelected}
            libCount={lib.length}
            explainText={explain.text}
            explainLoading={explain.loading}
            explainSource={explain.source}
            onChangeBottle={() => setSheetOpen(true)}
            onReset={() => setSelectedId(null)}
          />
          {/* 无香场合建议的是"今天不用"——既不该给备选（换哪瓶都一样不该用），
              也不该问「今天，刚好吗」（今天根本没喷，这个问题不成立） */}
          {activePick.usage.sprays[1] > 0 && (
            <>
              <AltList alts={altsToShow} base={activePick.perfume} onPick={(id) => adopt(id, "swap")} />
              <FeedbackBar perfume={activePick.perfume} ctx={ctx} sprays={activePick.usage.sprays} />
            </>
          )}
        </>
      ) : null}

      <ChangeBottleSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        perfumes={lib}
        currentId={activePick?.perfume.id ?? null}
        onSelect={(id) => {
          // 从"换一瓶"里选定 = 今天采纳这瓶 → 记一笔用香（解耦"记录用香"与"留反馈"，修正吃灰误判）
          adopt(id, "swap");
        }}
      />
    </div>
  );
}

// 目录（1.6MB JSON）加载失败但本地有香柜 → 明确告知"数据没丢 + 重试"，绝不把满柜误显示成空柜
function CatalogError({ count, onRetry }: { count: number; onRetry: () => void }) {
  return (
    <div className="card animate-fade-up flex flex-col items-center gap-5 px-6 py-12 text-center">
      <div>
        <h3 className="serif text-[1.3rem] font-bold text-ink">香水目录没加载出来</h3>
        <p className="serif mx-auto mt-2.5 max-w-xs text-[0.9rem] leading-relaxed text-ink-soft">
          可能是网络波动。你香柜里的 {count} 瓶香水都还在，没有丢——
          点下面重试就能恢复今日推荐。
        </p>
      </div>
      <button onClick={onRetry} className="btn-primary px-6 py-3 text-[0.9rem]">
        重新加载
      </button>
    </div>
  );
}
