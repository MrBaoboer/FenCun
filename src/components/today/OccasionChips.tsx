"use client";
import { useStore } from "@/lib/store";
import type { Occasion } from "@/lib/types";

const OCCASIONS: { key: Occasion; label: string }[] = [
  { key: "commute", label: "通勤" },
  { key: "work", label: "上班" },
  { key: "date", label: "约会" },
  { key: "social", label: "聚会" },
  { key: "formal", label: "正式" },
  { key: "home", label: "居家" },
  { key: "sport", label: "运动" },
];

export function OccasionChips() {
  const occasion = useStore((s) => s.occasion);
  const setOccasion = useStore((s) => s.setOccasion);
  return (
    <div className="flex flex-col gap-2">
      <span className="eyebrow px-1">今天的场合</span>
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {OCCASIONS.map((o) => (
          <button
            key={o.key}
            data-active={occasion === o.key}
            onClick={() => setOccasion(o.key)}
            className="chip shrink-0 px-4 py-1.5 text-sm"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
