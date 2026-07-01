"use client";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { useLibraryPerfumes } from "@/lib/hooks";
import { Eyebrow } from "@/components/ui";
import { SearchAdd } from "@/components/library/SearchAdd";
import { ShelfCard } from "@/components/library/ShelfCard";
import { PerfumeCard } from "@/components/library/PerfumeCard";

const DUSTY_MS = 30 * 24 * 3600 * 1000;

export default function LibraryPage() {
  const lib = useLibraryPerfumes();
  const userPerfumes = useStore((s) => s.userPerfumes);
  const removePerfume = useStore((s) => s.removePerfume);
  const hydrated = useStore((s) => s.hydrated);
  const [detailId, setDetailId] = useState<number | null>(null);
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
          {lib.length > 0 ? `${lib.length} 瓶在柜` : "空"}
        </span>
      </header>

      <SearchAdd />

      {!hydrated ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="h-32 animate-pulse bg-sunken/50" />
          <div className="h-32 animate-pulse bg-sunken/50" />
        </div>
      ) : lib.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <p className="serif text-[0.95rem] font-medium leading-relaxed text-ink-soft">
            香柜还空着。在上面搜一搜你拥有的香水——
            <br />
            可以搜品牌（如 香奈儿 / Chanel）、香名，或香调（如 玫瑰、木质）。
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
                onRemove={() => removePerfume(p.id)}
                onOpen={() => setDetailId(p.id)}
              />
            );
          })}
        </div>
      )}

      <PerfumeCard p={lib.find((x) => x.id === detailId) ?? null} onClose={() => setDetailId(null)} />
    </div>
  );
}
