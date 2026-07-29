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
import { shouldShowCatalogError } from "@/lib/catalog-state";

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
    // 撤销槽只有一个：8 秒内连删两瓶，第二次 setUndoItem 直接覆盖第一次，
    // 第一瓶的 RemovedBundle 就没有任何持有者了。目录香还能重搜回来（元数据归零），
    // 手动记的那瓶（负数 id）则是香名、品牌、香调、扩散档一次性永久丢失——
    // 正是 store.ts 注释自己写的「删掉就再也搜不回来……不给后悔的机会是不可接受的」。
    // 所以只对这一类拦一次：不可恢复的走确认，其余照旧走 8 秒撤销（弹窗太吵的取舍不变）。
    if (id < 0 && !window.confirm(`「${name}」删掉就找不回来了。确定移出香柜？`)) return;
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
        <span className="disp text-[0.8rem] tracking-wide text-ink-faint">
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
      ) : shouldShowCatalogError(catalogError, lib.length, userPerfumes.length) ? (
        // 与今日页同一条判据：看的是「有几瓶因此拿不出来」，不是「柜里有没有瓶」。
        // 扩展集与手动记录的香整条存在本机，目录挂了也一瓶不少。
        <div className="card px-6 py-12 text-center">
          <p className="serif text-[0.95rem] font-medium leading-relaxed text-ink-soft">
            {userPerfumes.length > lib.length
              ? `香水目录没加载出来，有 ${userPerfumes.length - lib.length} 瓶暂时取不出来。`
              : "香水目录没加载出来，现在搜不出结果。要记一瓶，用搜索框里的「手动记一瓶」。"}
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
            在上面搜一搜你拥有的香水
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
          <span className="serif min-w-0 truncate text-[0.85rem] text-ink-soft">
            已把「{undoItem.name}」移出香柜
          </span>
          <button
            onClick={() => {
              restorePerfume(undoItem.bundle);
              if (undoTimer.current) clearTimeout(undoTimer.current);
              setUndoItem(null);
            }}
            className="shrink-0 text-[0.85rem] font-semibold text-accent underline-offset-4 hover:underline"
          >
            撤销
          </button>
        </div>
      )}
    </div>
  );
}
