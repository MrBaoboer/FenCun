"use client";
import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Eyebrow } from "@/components/ui";
import { OccasionChips } from "@/components/today/OccasionChips";
import { SceneInput } from "@/components/today/SceneInput";
import { FEEL_ZH } from "@/lib/season";
import { weatherGreeting } from "@/lib/greeting";
import type { Context } from "@/lib/types";

function dateLabel() {
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  } catch {
    return "今天";
  }
}

function CityForm({ onDone }: { onDone: () => void }) {
  const { resolveByCity } = useApp();
  const [cityInput, setCityInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cityInput.trim()) return;
    setBusy(true);
    setErr("");
    const ok = await resolveByCity(cityInput.trim());
    setBusy(false);
    if (ok) onDone();
    else setErr("没找到这个城市，换个写法试试");
  }
  return (
    <>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={cityInput}
          onChange={(e) => setCityInput(e.target.value)}
          placeholder="例如：上海、杭州、成都"
          className="serif flex-1 border-b border-line-strong bg-transparent px-1 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <button type="submit" disabled={busy} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
          {busy ? "…" : "确定"}
        </button>
      </form>
      {err && <p className="mt-2 text-xs text-warn">{err}</p>}
    </>
  );
}

function LocationPin() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 text-accent">
      <path d="M12 21s6.5-5.4 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.6 12 21 12 21Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="12" cy="10.2" r="2.3" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function ContextBar({ ctx }: { ctx: Context | null }) {
  const { locState, resolveByCoords } = useApp();
  const [editing, setEditing] = useState(false);

  return (
    <div className="card animate-fade-in px-5 py-5">
      {/* 顶行：此刻 + 日期 */}
      <div className="flex items-center justify-between">
        <Eyebrow>此刻 · Now</Eyebrow>
        <span className="disp text-[0.72rem] tracking-[0.1em] text-ink-faint">{dateLabel()}</span>
      </div>

      {ctx ? (
        <>
          <button
            onClick={() => setEditing((v) => !v)}
            className="group mt-3 flex items-center gap-1.5"
            aria-label="切换城市"
          >
            <LocationPin />
            <span className="serif text-[0.98rem] font-semibold text-ink group-hover:text-accent">
              {ctx.city}
            </span>
            <svg width="11" height="11" viewBox="0 0 24 24" className={`text-ink-faint transition-transform ${editing ? "rotate-180" : ""}`}>
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" />
            </svg>
          </button>

          <div className="mt-3.5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="serif truncate text-[1.55rem] font-bold leading-tight text-ink">
                {weatherGreeting(ctx)}
              </div>
              <p className="mt-2 text-[0.78rem] text-ink-faint">
                湿度 {Math.round(ctx.humidity)}% · 体感{FEEL_ZH[ctx.feel]}
              </p>
            </div>
            {/* 阴 · 30°：内部居中；整块与左栏两行垂直居中，填平右下空白 */}
            <div className="serif inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-ink">
              <span className="text-[1.2rem] text-ink-soft">{ctx.weatherText}</span>
              <span className="text-[1.05rem] text-ink-faint">·</span>
              <span className="disp text-[2.15rem] font-normal leading-none">
                {Math.round(ctx.tempC)}
                <span className="align-super text-[0.5em] text-accent">°</span>
              </span>
            </div>
          </div>
          {editing && <CityForm onDone={() => setEditing(false)} />}
        </>
      ) : locState === "locating" ? (
        <p className="serif mt-3 text-sm text-ink-faint">正在感知此刻的天气与体感…</p>
      ) : (
        <div className="mt-2">
          <div className="flex items-center gap-1.5">
            <LocationPin />
            <span className="serif text-[0.95rem] font-medium text-ink-soft">没拿到你的位置</span>
          </div>
          <p className="serif mt-1.5 text-[0.88rem] text-ink-faint">告诉我你在哪座城市，我来感知今天的天气。</p>
          <CityForm onDone={() => {}} />
          <button onClick={resolveByCoords} className="mt-2.5 text-xs text-ink-faint underline-offset-2 hover:underline">
            或再试一次自动定位
          </button>
        </div>
      )}

      {/* 场合选择 + 自然语言场景 —— 并入此刻卡片 */}
      <div className="mt-5 border-t border-line pt-4">
        <OccasionChips />
        <div className="mt-3">
          <SceneInput />
        </div>
      </div>
    </div>
  );
}
