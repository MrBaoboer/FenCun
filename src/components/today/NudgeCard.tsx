"use client";
import { Eyebrow } from "@/components/ui";
import { nameParts } from "@/lib/format";
import type { Nudge } from "@/lib/hooks";

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0 text-accent">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0 text-warn">
      <path d="M12 3.5 21 19H3L12 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 10v4M12 16.5v.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function NudgeCard({ nudge, onPick }: { nudge: Nudge; onPick: (id: number) => void }) {
  if (nudge.kind === "dusty") {
    const np = nameParts(nudge.perfume);
    return (
      <div className="card animate-fade-up flex items-center gap-3 px-4 py-3.5">
        <ClockIcon />
        <div className="min-w-0 flex-1">
          <Eyebrow>搁置 {nudge.days} 天 · 今天正合适</Eyebrow>
          <p className="mt-1.5 truncate">
            <span className={`text-[0.98rem] text-ink ${np.primaryIsZh ? "serif font-bold" : "disp font-semibold"}`}>
              {np.primary}
            </span>
            {np.secondary && <span className="en-italic ml-1.5 text-[0.8rem]">{np.secondary}</span>}
          </p>
          <p className="serif mt-0.5 truncate text-[0.8rem] text-ink-soft">{nudge.pick.reasons[0]}</p>
        </div>
        <button
          onClick={() => onPick(nudge.perfume.id)}
          className="btn-ghost shrink-0 self-center px-3.5 py-2 text-[0.82rem]"
        >
          翻出来
        </button>
      </div>
    );
  }

  const hp = nameParts(nudge.habitual);
  const bp = nudge.better ? nameParts(nudge.better) : null;
  return (
    <div
      className="animate-fade-up rounded-card border bg-warn-wash px-4 py-3.5"
      style={{ borderColor: "color-mix(in srgb, var(--color-warn) 32%, transparent)" }}
    >
      <div className="flex items-start gap-3">
        <AlertIcon />
        <div className="min-w-0 flex-1">
          <Eyebrow className="!text-warn">天气突变 · 你常喷的这瓶要留意</Eyebrow>
          <p className="serif mt-1.5 text-[0.9rem] leading-relaxed text-ink-soft">
            <span className="font-bold text-ink">{hp.primary}</span>：{nudge.reason}
          </p>
        </div>
      </div>
      {nudge.better && bp && (
        <button onClick={() => onPick(nudge.better!.id)} className="btn-primary mt-3 w-full py-2.5 text-[0.85rem]">
          换成「{bp.primary}」更合适
        </button>
      )}
    </div>
  );
}
