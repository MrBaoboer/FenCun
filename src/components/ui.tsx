"use client";
import { ReactNode } from "react";

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}

// 证据条：把 0..1 的匹配度渲染成一次性生长的横条
export function EvidenceBar({
  label,
  value,
  hint,
  tone = "brand",
}: {
  label: string;
  value: number; // 0..1
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
      <div className="h-[5px] w-full overflow-hidden rounded-pill bg-sunken">
        <div
          className="bar-grow h-full rounded-pill"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// 香调条：中文香调 + 0..100 强度
export function AccordBar({ zh, strength }: { zh: string; strength: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-right text-[0.8rem] text-ink-soft">{zh}</span>
      <div className="h-[5px] flex-1 overflow-hidden rounded-pill bg-sunken">
        <div
          className="bar-grow h-full rounded-pill"
          style={{ width: `${strength}%`, backgroundColor: "var(--color-brand-soft)" }}
        />
      </div>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span className="eyebrow">{label}</span>
      <span className="text-base font-medium text-ink">{value}</span>
      {sub && <span className="text-[0.72rem] leading-tight text-ink-faint">{sub}</span>}
    </div>
  );
}

export function Divider() {
  return (
    <div className="flex items-center justify-center py-1">
      <span className="h-1 w-1 rotate-45 bg-accent/60" />
    </div>
  );
}
