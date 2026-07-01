"use client";
import { ReactNode } from "react";

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}

// 证据条：0..1 匹配度 → 一次性生长的细横条
export function EvidenceBar({
  label,
  value,
  hint,
  tone = "brand",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "brand" | "accent" | "warn";
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color =
    tone === "accent" ? "var(--color-accent)" : tone === "warn" ? "var(--color-warn)" : "var(--color-brand)";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[0.82rem] text-ink-soft">{label}</span>
        {hint && <span className="text-[0.72rem] text-ink-faint">{hint}</span>}
      </div>
      <div className="h-[3px] w-full overflow-hidden bg-sunken">
        <div className="bar-grow h-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// 香调条：中文香调 + 0..100 强度
export function AccordBar({ zh, strength }: { zh: string; strength: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="serif w-20 shrink-0 text-right text-[0.82rem] text-ink-soft">{zh}</span>
      <div className="h-[3px] flex-1 overflow-hidden bg-sunken">
        <div className="bar-grow h-full" style={{ width: `${strength}%`, backgroundColor: "var(--color-accent-soft)" }} />
      </div>
    </div>
  );
}

// 规格单元：小眉标 + 宋体值 + 说明
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="eyebrow eyebrow-mute !text-[0.58rem]">{label}</span>
      <span className="serif text-[1.15rem] font-bold leading-none text-ink">{value}</span>
      {sub && <span className="text-[0.68rem] leading-tight text-ink-faint">{sub}</span>}
    </div>
  );
}
