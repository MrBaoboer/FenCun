"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type AdoptSnapshot } from "@/lib/store";
import { useApp } from "@/components/AppProvider";
import {
  useResolvedContext,
  useRecommendation,
  useLibraryPerfumes,
  useExplain,
  useNudges,
} from "@/lib/hooks";
import { buildPick, aggregateBias } from "@/lib/recommend";
import { wearEntryFrom, dateKey } from "@/lib/journal";
import { nameParts, DISTANCE_LABEL } from "@/lib/format";
import type { ScoredPick } from "@/lib/types";
import { ContextBar } from "@/components/today/ContextBar";
import { NudgeCard } from "@/components/today/NudgeCard";
import { RecommendationCard } from "@/components/today/RecommendationCard";
import { AltList } from "@/components/today/AltList";
import { FeedbackBar } from "@/components/today/FeedbackBar";
import { ChangeBottleSheet } from "@/components/today/ChangeBottleSheet";
import { EmptyShelf } from "@/components/today/EmptyShelf";
import { shouldShowCatalogError } from "@/lib/catalog-state";

export default function TodayPage() {
  const ctx = useResolvedContext();
  const rec = useRecommendation(ctx);
  const lib = useLibraryPerfumes();
  const feedbacks = useStore((s) => s.feedbacks);
  const userPerfumes = useStore((s) => s.userPerfumes);
  const markWorn = useStore((s) => s.markWorn);
  const snapshotAdopt = useStore((s) => s.snapshotAdopt);
  const undoAdopt = useStore((s) => s.undoAdopt);
  const logWear = useStore((s) => s.logWear);
  const recordSwap = useStore((s) => s.recordSwap);
  const recordDustyAdopt = useStore((s) => s.recordDustyAdopt);
  const hydrated = useStore((s) => s.hydrated);
  const { catalog, catalogError, retryCatalog } = useApp();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // 一串快照，不是一张：「想比三瓶用法」正是这条撤销存在的理由，
  // 而连续采纳时只留最后一张，撤销就只回滚最后那一瓶——前两瓶的穿戴计数、
  // 香历与隐式差评照样留着。撤销掉一部分比不撤销更难解释。
  const [undoAdoptItem, setUndoAdoptItem] = useState<{
    name: string;
    count: number;
    snaps: AdoptSnapshot[];
    prevSelectedId: number | null;
  } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

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
  //
  // 「选定即采纳」是既定设计（解耦"记录用香"与"留反馈"，修正吃灰误判），不改。
  // 但两个入口的文案都是浏览语义（「也可以考虑」「从你的香柜里选」），这三笔写入
  // 此前完全无声、也不可撤销——想比三瓶用法，三瓶就全被记成今天穿过，
  // 轮换的新鲜度与吃灰的 21 天计时一起重置。所以给一条和香柜移除同款的 8 秒后悔路。
  const adopt = (id: number, kind: "swap" | "dusty") => {
    const snap = ctx ? snapshotAdopt(id, dateKey(Date.now())) : null;
    setSelectedId(id);
    markWorn(id);
    const p = lib.find((x) => x.id === id);
    if (p && ctx) logWear(wearEntryFrom(p, ctx));
    if (kind === "dusty") recordDustyAdopt();
    else if (kind === "swap" && rec?.primary && id !== rec.primary.perfume.id)
      recordSwap(rec.primary.perfume.id);
    if (snap && p) {
      setUndoAdoptItem((prev) => ({
        name: nameParts(p).primary,
        count: (prev?.count ?? 0) + 1,
        // 追加而不是覆盖；prevSelectedId 保留这一串开始之前的那个
        snaps: [...(prev?.snaps ?? []), snap],
        prevSelectedId: prev?.prevSelectedId ?? selectedId,
      }));
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndoAdoptItem(null), 8000);
    }
  };

  // 换瓶弹层与「也可以考虑」必须给同一瓶报同一个社交距离档。
  // rec.ranked 已经为柜里每一瓶算过 ScoredPick，直接复用，不再多算一遍、也不会算出第二个答案。
  const tierById = useMemo(
    () => new Map(rec?.ranked.map((r) => [r.perfume.id, r.usage.socialDistance] as const) ?? []),
    [rec]
  );

  const explain = useExplain(activePick, ctx);
  const nudges = useNudges(ctx, rec);

  return (
    <div className="flex flex-col gap-5">
      {/* 今日页的视觉开头是情境条（问候语随天气变），设计上刻意没有页面标题。
          但"没有 h1"对屏幕阅读器和搜索引擎都是缺一个入口——首页此前全站唯一的标题层级是一个 h3。
          用视觉隐藏的 h1 补上语义，不动已经立住的版面。 */}
      <h1 className="sr-only">今日 · 从你的香柜里挑一瓶</h1>
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
      ) : shouldShowCatalogError(catalogError, lib.length, userPerfumes.length) ? (
        // 判据是「**有几瓶因此拿不出来**」，不是「柜里有没有瓶」。
        // 扩展集与手动记录的香整条存在本机，目录挂了它们照样在——按旧判据，
        // 一个全部由国货/手动记录组成的香柜会被整块拦在一张"没加载出来"的卡后面，
        // 而它其实一瓶都不缺。
        <CatalogError count={userPerfumes.length - lib.length} onRetry={retryCatalog} />
      ) : catalog === null && !catalogError ? (
        // 目录还在加载：继续骨架屏——满柜用户在这个窗口期不该看到"空柜"（那句话对他们是假的）
        <div className="h-56 animate-pulse bg-sunken/50" />
      ) : lib.length === 0 ? (
        <EmptyShelf />
      ) : !ctx ? (
        <p className="serif px-1 text-[0.82rem] leading-relaxed text-ink-faint">
          等天气到位，就从你的香柜里挑一瓶。
        </p>
      ) : activePick ? (
        <>
          {ctx.approximate && (
            <p className="serif px-1 text-[0.82rem] leading-relaxed text-ink-faint">
              这条推荐先按季节和时段来。
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
            allAvoid={rec?.allAvoid ?? false}
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

      {/* 换场合 / 换瓶 / 点备选之后，h2 香名、喷量、社交距离、留香整块换掉，
          此前对读屏用户全程静默——而这三项正是产品的全部输出。
          只播报规则算出来的档位与区间（不触反伪精确），不把整块包成 live region：
          那里面有 details 折叠、证据条与香调条，任何一次重渲染都会被整段重播。 */}
      <p role="status" aria-live="polite" className="sr-only">
        {activePick
          ? `${nameParts(activePick.perfume).primary}｜${activePick.usage.spraysLabel}｜${DISTANCE_LABEL[activePick.usage.socialDistance]}`
          : ""}
      </p>

      {undoAdoptItem && (
        <div
          role="status"
          className="animate-fade-up fixed inset-x-0 bottom-24 z-40 mx-auto flex w-[min(26rem,calc(100%-2rem))] items-center justify-between gap-3 rounded-card border border-line-strong bg-surface px-4 py-3 shadow-float"
        >
          <span className="serif min-w-0 truncate text-[0.85rem] text-ink-soft">
            {undoAdoptItem.count > 1
              ? `已把「${undoAdoptItem.name}」等 ${undoAdoptItem.count} 瓶记进今天的香历`
              : `已把「${undoAdoptItem.name}」记进今天的香历`}
          </span>
          <button
            onClick={() => {
              undoAdopt(undoAdoptItem.snaps);
              setSelectedId(undoAdoptItem.prevSelectedId);
              if (undoTimer.current) clearTimeout(undoTimer.current);
              setUndoAdoptItem(null);
            }}
            className="shrink-0 text-[0.85rem] font-semibold text-accent underline-offset-4 hover:underline"
          >
            撤销
          </button>
        </div>
      )}

      <ChangeBottleSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        perfumes={lib}
        tierById={tierById}
        currentId={activePick?.perfume.id ?? null}
        onSelect={(id) => {
          // 从"换一瓶"里选定 = 今天采纳这瓶 → 记一笔用香（解耦"记录用香"与"留反馈"，修正吃灰误判）
          adopt(id, "swap");
        }}
      />
    </div>
  );
}

// 目录（1.6MB JSON）加载失败、且确有瓶子因此拿不出来 → 明确告知"数据没丢 + 重试"，绝不把满柜误显示成空柜
function CatalogError({ count, onRetry }: { count: number; onRetry: () => void }) {
  return (
    <div className="card animate-fade-up flex flex-col items-center gap-5 px-6 py-12 text-center">
      <div>
        <h3 className="serif text-[1.3rem] font-bold text-ink">香水目录没加载出来</h3>
        {/* 空柜访客与满柜用户要说不同的话：前者没有"瓶"可丢，他需要的是那条不依赖目录的出口。 */}
        <p className="serif mx-auto mt-2.5 max-w-xs text-[0.9rem] leading-relaxed text-ink-soft">
          {count > 0 ? (
            <>有 {count} 瓶暂时取不出来，它们都还在。</>
          ) : (
            <>现在搜什么都查不到。也可以到香柜里「手动记一瓶」。</>
          )}
        </p>
      </div>
      <button onClick={onRetry} className="btn-primary px-6 py-3 text-[0.9rem]">
        重新加载
      </button>
    </div>
  );
}
