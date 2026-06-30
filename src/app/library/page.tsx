"use client";
import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { useLibraryPerfumes } from "@/lib/hooks";
import { Eyebrow } from "@/components/ui";
import { SearchAdd } from "@/components/library/SearchAdd";
import { ShelfCard } from "@/components/library/ShelfCard";

const DUSTY_MS = 30 * 24 * 3600 * 1000;

export default function LibraryPage() {
  const lib = useLibraryPerfumes();
  const userPerfumes = useStore((s) => s.userPerfumes);
  const removePerfume = useStore((s) => s.removePerfume);
  const hydrated = useStore((s) => s.hydrated);
  const wornMap = useMemo(
    () => new Map(userPerfumes.map((u) => [u.perfumeId, u])),
    [userPerfumes]
  );
  const now = Date.now();

  return (
    <div className="flex flex-col gap-5">
      <header className="px-1">
        <Eyebrow>香柜 · Shelf</Eyebrow>
        <h1 className="mt-1 text-2xl font-medium tracking-tight text-ink">我的香柜</h1>
        <p className="mt-1 text-sm text-ink-faint">
          {lib.length > 0 ? `${lib.length} 瓶在柜` : "搜名字，一点就入柜"}
        </p>
      </header>

      <SearchAdd />

      {!hydrated ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="card h-32 animate-pulse bg-sunken/40" />
          <div className="card h-32 animate-pulse bg-sunken/40" />
        </div>
      ) : lib.length === 0 ? (
        <div className="card px-6 py-10 text-center">
          <p className="text-sm leading-relaxed text-ink-soft">
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
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
