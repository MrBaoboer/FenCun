"use client";
import { SILLAGE_WORD, durationShort, nameParts } from "@/lib/format";
import type { Perfume } from "@/lib/types";

export function ShelfCard({
  p,
  dusty,
  onRemove,
  onOpen,
}: {
  p: Perfume;
  dusty?: boolean;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const np = nameParts(p);
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
      className="card relative flex cursor-pointer flex-col p-4 transition-shadow hover:border-line-strong"
    >
      {dusty && (
        <span className="eyebrow absolute right-3 top-3.5 !text-[0.55rem] !text-warn">很久没用</span>
      )}
      <div className={`truncate pr-14 text-[1.08rem] text-ink ${np.primaryIsZh ? "serif font-bold" : "disp font-semibold"}`}>
        {np.primary}
      </div>
      <div className="mt-1 truncate text-[0.72rem] text-ink-faint">
        {np.secondary ? <span className="en-italic">{np.secondary}</span> : null}
        {np.secondary ? " · " : ""}
        {p.brandZh}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-line pt-3 text-[0.68rem] text-ink-faint">
        <span className="serif shrink-0 text-ink-soft">{p.styleTags[0]}</span>
        <span className="disp ml-auto min-w-0 truncate tracking-wide">
          {SILLAGE_WORD[p.sillageTier]} · {durationShort(p.longevity)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="-mr-1 shrink-0 p-1 text-ink-faint opacity-50 transition-all hover:text-warn hover:opacity-100 focus:opacity-100"
          aria-label="移出香柜"
          title="移出香柜"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M6 7h12M9 7V5h6v2M8 7l1 12h6l1-12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
