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
  const scene = useStore((s) => s.scene);
  const setOccasion = useStore((s) => s.setOccasion);
  const active = scene?.occasion ?? occasion;
  return (
    <div className="flex flex-col gap-2.5">
      <span className="eyebrow eyebrow-mute">今天去哪儿</span>
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {OCCASIONS.map((o) => (
          <button
            key={o.key}
            data-active={active === o.key}
            onClick={() => setOccasion(o.key)}
            className="chip serif shrink-0 px-3.5 py-1.5 text-[0.88rem]"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
