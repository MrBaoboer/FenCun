// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

"use client";
import { Eyebrow } from "@/components/ui";
import { SILLAGE_WORD, nameParts } from "@/lib/format";
import { altDiffLabel } from "@/lib/journal";
import type { ScoredPick, Perfume } from "@/lib/types";

// base = 当前展示的那瓶：备选不该只是名字的罗列，一句话说清「它和这瓶差在哪」，换瓶才是有信息量的选择
export function AltList({
  alts,
  base,
  onPick,
}: {
  alts: ScoredPick[];
  base?: Perfume | null;
  onPick: (id: number) => void;
}) {
  if (!alts.length) return null;
  return (
    <div className="card px-5 py-4">
      <Eyebrow className="eyebrow-mute">也可以考虑</Eyebrow>
      <div className="mt-1">
        {alts.map((a, i) => {
          const np = nameParts(a.perfume);
          const last = i === alts.length - 1;
          const diff = base && base.id !== a.perfume.id ? altDiffLabel(a.perfume, base) : null;
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
              <div className="disp shrink-0 text-right text-[0.74rem] font-medium tracking-wide text-ink-soft">
                {diff && <span className="serif mr-2 text-accent">{diff}</span>}
                {a.usage.spraysLabel} · {SILLAGE_WORD[a.usage.socialDistance]}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
