"use client";
import { Eyebrow } from "@/components/ui";
import { SILLAGE_WORD, nameParts } from "@/lib/format";
import type { ScoredPick } from "@/lib/types";

export function AltList({ alts, onPick }: { alts: ScoredPick[]; onPick: (id: number) => void }) {
  if (!alts.length) return null;
  return (
    <div className="card px-5 py-4">
      <Eyebrow className="eyebrow-mute">也可以考虑</Eyebrow>
      <div className="mt-1">
        {alts.map((a, i) => {
          const np = nameParts(a.perfume);
          const last = i === alts.length - 1;
          return (
            <button
              key={a.perfume.id}
              onClick={() => onPick(a.perfume.id)}
              className={`flex w-full items-baseline justify-between gap-3 py-3 text-left transition-opacity hover:opacity-70 ${
                last ? "" : "border-b border-line"
              }`}
            >
              <div className="min-w-0">
                <span className={`text-[1.08rem] text-ink ${np.primaryIsZh ? "serif font-bold" : "disp font-semibold"}`}>
                  {np.primary}
                </span>
                {np.secondary && <span className="en-italic ml-2 text-[0.82rem]">{np.secondary}</span>}
                <div className="mt-0.5 truncate text-[0.74rem] text-ink-faint">
                  {a.perfume.brandZh} · {a.perfume.styleTags[0]}
                </div>
              </div>
              <div className="disp shrink-0 text-[0.74rem] font-medium tracking-wide text-ink-soft">
                {a.usage.spraysLabel} · {SILLAGE_WORD[a.usage.socialDistance]}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
