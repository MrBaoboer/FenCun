"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useStore } from "@/lib/store";
import { buildSearch } from "@/lib/perfumes";
import { nameParts } from "@/lib/format";
import type { Perfume } from "@/lib/types";

export function SearchAdd() {
  const { catalog } = useApp();
  const addPerfume = useStore((s) => s.addPerfume);
  const userPerfumes = useStore((s) => s.userPerfumes);
  const inLib = useMemo(() => new Set(userPerfumes.map((u) => u.perfumeId)), [userPerfumes]);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Perfume[]>([]);
  const [focused, setFocused] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const ms = useMemo(() => (catalog ? buildSearch(catalog) : null), [catalog]);
  const byId = useMemo(() => new Map((catalog ?? []).map((p) => [p.id, p])), [catalog]);

  useEffect(() => {
    if (!ms || !q.trim()) {
      setResults([]);
      return;
    }
    const hits = ms.search(q.trim()).slice(0, 8);
    setResults(hits.map((h) => byId.get(h.id as number)).filter(Boolean) as Perfume[]);
  }, [q, ms, byId]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const open = focused && q.trim().length > 0;

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2.5 focus-within:border-brand">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0">
          <circle cx="11" cy="11" r="6.5" stroke="var(--color-ink-faint)" strokeWidth="1.6" />
          <path d="M20 20l-4-4" stroke="var(--color-ink-faint)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="搜香名 / 品牌 / 香调，点一下就入柜"
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink-faint"
        />
        {q && (
          <button onClick={() => setQ("")} className="text-ink-faint" aria-label="清空">
            ×
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-20 mt-2 w-full animate-fade-in overflow-hidden rounded-lg border border-line bg-surface shadow-float">
          {results.length === 0 ? (
            <div className="px-4 py-5 text-center text-sm text-ink-faint">
              没搜到。换个写法，或先记下名字晚点补充。
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {results.map((p) => {
                const added = inLib.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      disabled={added}
                      onClick={() => addPerfume(p.id)}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-sunken disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <div className="min-w-0">
                        {(() => {
                          const np = nameParts(p);
                          return (
                            <>
                              <div className={`truncate text-[1rem] text-ink ${np.primaryIsZh ? "" : "font-display"}`}>
                                {np.primary}
                              </div>
                              <div className="mt-0.5 truncate text-[0.74rem] text-ink-faint">
                                {np.secondary ? `${np.secondary} · ` : ""}
                                {p.brandZh} · {p.styleTags[0]}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      <span
                        className={`ml-3 shrink-0 rounded-pill px-2.5 py-1 text-[0.72rem] ${
                          added ? "text-ink-faint" : "bg-ink text-paper"
                        }`}
                      >
                        {added ? "已在柜" : "+ 入柜"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
