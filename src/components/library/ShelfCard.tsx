"use client";
import { SILLAGE_WORD, durationShort, nameParts } from "@/lib/format";
import type { Perfume } from "@/lib/types";

export function ShelfCard({
  p,
  dusty,
  onRemove,
}: {
  p: Perfume;
  dusty?: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="card relative flex flex-col px-4 py-4">
      {dusty && (
        <span className="absolute right-3 top-3 rounded-pill bg-warn-wash px-2 py-0.5 text-[0.64rem] text-warn">
          很久没用
        </span>
      )}
      {(() => {
        const np = nameParts(p);
        return (
          <>
            <div className={`truncate pr-16 text-[1.05rem] text-ink ${np.primaryIsZh ? "" : "font-display"}`}>
              {np.primary}
            </div>
            <div className="mt-0.5 truncate text-[0.74rem] text-ink-faint">
              {np.secondary ? `${np.secondary} · ` : ""}
              {p.brandZh}
            </div>
          </>
        );
      })()}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {p.styleTags.slice(0, 2).map((t) => (
          <span key={t} className="rounded-pill bg-brand-wash px-2 py-0.5 text-[0.68rem] text-brand">
            {t}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-[0.7rem] text-ink-faint">
        <span>扩散 {SILLAGE_WORD[p.sillageTier]}</span>
        <span>留香 {durationShort(p.longevity)}</span>
      </div>
      <button
        onClick={onRemove}
        className="absolute bottom-3.5 right-3 text-ink-faint opacity-50 transition-all hover:text-warn hover:opacity-100 focus:opacity-100"
        aria-label="移出香柜"
        title="移出香柜"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M6 7h12M9 7V5h6v2M8 7l1 12h6l1-12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
