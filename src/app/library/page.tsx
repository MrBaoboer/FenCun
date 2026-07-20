"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type RemovedBundle } from "@/lib/store";
import { useApp } from "@/components/AppProvider";
import { useLibraryPerfumes, DUSTY_MS } from "@/lib/hooks";
import { Eyebrow } from "@/components/ui";
import { nameParts } from "@/lib/format";
import { SearchAdd } from "@/components/library/SearchAdd";
import { ShelfCard } from "@/components/library/ShelfCard";
import { PerfumeCard } from "@/components/library/PerfumeCard";

export default function LibraryPage() {
  const lib = useLibraryPerfumes();
  const userPerfumes = useStore((s) => s.userPerfumes);
  const removePerfume = useStore((s) => s.removePerfume);
  const restorePerfume = useStore((s) => s.restorePerfume);
  const hydrated = useStore((s) => s.hydrated);
  const { catalog, catalogError, retryCatalog } = useApp();
  const [detailId, setDetailId] = useState<number | null>(null);

  // 撤销而非二次确认：删除是本机不可逆操作（手动记录的香水删掉就永远找不回来），
  // 但弹窗拦在每一次删除前太吵。给一条 8 秒的后悔路，既不打断也不至于失手清空。
  const [undoItem, setUndoItem] = useState<{ name: string; bundle: RemovedBundle } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  const handleRemove = (id: number, name: string) => {
    const bundle = removePerfume(id);
    if (detailId === id) setDetailId(null);
    setUndoItem({ name, bundle });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoItem(null), 8000);
  };
  const wornMap = useMemo(
    () => new Map(userPerfumes.map((u) => [u.perfumeId, u])),
    [userPerfumes]
  );
  const now = Date.now();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between border-b border-line pb-4">
        <div>
          <Eyebrow>香柜 · Shelf</Eyebrow>
          <h1 className="serif mt-1.5 text-[1.7rem] font-bold text-ink">我的香柜</h1>
        </div>
        <span className="disp text-[0.78rem] tracking-wide text-ink-faint">
          {!hydrated || (catalog === null && !catalogError)
            ? "—"
            : lib.length > 0
              ? `${lib.length} 瓶在柜`
              : "空"}
        </span>
      </header>

      <SearchAdd />

      {!hydrated ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="h-32 animate-pulse bg-sunken/50" />
          <div className="h-32 animate-pulse bg-sunken/50" />
        </div>
      ) : catalogError && userPerfumes.length > 0 ? (
        <div className="card px-6 py-12 text-center">
          <p className="serif text-[0.95rem] font-medium leading-relaxed text-ink-soft">
            香水目录没加载出来（可能是网络波动）。你收藏的 {userPerfumes.length} 瓶都还在，没有丢。
          </p>
          <button onClick={retryCatalog} className="btn-primary mt-4 px-6 py-3 text-[0.9rem]">
            重新加载
          </button>
        </div>
      ) : catalog === null && !catalogError ? (
        // 目录还在加载：继续骨架屏——满柜用户在这个窗口期不该看到「香柜还空着」（那句话对他们是假的）
        <div className="grid grid-cols-2 gap-3">
          <div className="h-32 animate-pulse bg-sunken/50" />
          <div className="h-32 animate-pulse bg-sunken/50" />
        </div>
      ) : lib.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <p className="serif text-[0.95rem] font-medium leading-relaxed text-ink-soft">
            香柜还空着<br />
            在上面搜一搜你拥有的香水<br />
            可以搜品牌（如 香奈儿 / Chanel）、香名，或香调（如 玫瑰、木质）
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {lib.map((p) => {
            const u = wornMap.get(p.id);
            const dusty = u
              ? u.lastWornAt
                ? now - u.lastWornAt > DUSTY_MS
                : now - u.addedAt > DUSTY_MS
              : false;
            return (
              <ShelfCard
                key={p.id}
                p={p}
                dusty={dusty}
                onRemove={() => handleRemove(p.id, nameParts(p).primary)}
                onOpen={() => setDetailId(p.id)}
              />
            );
          })}
        </div>
      )}

      <PerfumeCard p={lib.find((x) => x.id === detailId) ?? null} onClose={() => setDetailId(null)} />

      {undoItem && (
        <div
          role="status"
          className="animate-fade-up fixed inset-x-0 bottom-24 z-40 mx-auto flex w-[min(26rem,calc(100%-2rem))] items-center justify-between gap-3 rounded-card border border-line-strong bg-surface px-4 py-3 shadow-float"
        >
          <span className="serif min-w-0 truncate text-[0.86rem] text-ink-soft">
            已把『{undoItem.name}』移出香柜
          </span>
          <button
            onClick={() => {
              restorePerfume(undoItem.bundle);
              if (undoTimer.current) clearTimeout(undoTimer.current);
              setUndoItem(null);
            }}
            className="shrink-0 text-[0.86rem] font-semibold text-accent underline-offset-4 hover:underline"
          >
            撤销
          </button>
        </div>
      )}
    </div>
  );
}
