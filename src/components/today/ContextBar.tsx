"use client";
import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Eyebrow } from "@/components/ui";
import { FEEL_ZH, SEASON_ZH } from "@/lib/season";
import type { Context } from "@/lib/types";

export function ContextBar({ ctx }: { ctx: Context | null }) {
  const { locState, resolveByCoords, resolveByCity } = useApp();
  const [editing, setEditing] = useState(false);
  const [cityInput, setCityInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submitCity(e: React.FormEvent) {
    e.preventDefault();
    if (!cityInput.trim()) return;
    setBusy(true);
    setErr("");
    const ok = await resolveByCity(cityInput.trim());
    setBusy(false);
    if (ok) {
      setEditing(false);
      setCityInput("");
    } else setErr("没找到这个城市，换个写法试试");
  }

  // 定位中
  if (!ctx && locState === "locating") {
    return (
      <div className="card animate-fade-in px-5 py-4">
        <Eyebrow>此刻 · Now</Eyebrow>
        <p className="mt-1.5 text-sm text-ink-faint">正在感知此刻的天气与体感…</p>
      </div>
    );
  }

  // 定位失败 / 需要手填城市
  if (!ctx) {
    return (
      <div className="card animate-fade-in px-5 py-4">
        <Eyebrow>此刻 · Now</Eyebrow>
        <p className="mt-1.5 text-sm text-ink-soft">
          没拿到你的位置。告诉我你在哪座城市，我来感知今天的天气。
        </p>
        <form onSubmit={submitCity} className="mt-3 flex gap-2">
          <input
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            placeholder="例如：上海、杭州、成都"
            className="flex-1 rounded-lg border border-line bg-sunken px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
          >
            {busy ? "…" : "确定"}
          </button>
        </form>
        {err && <p className="mt-2 text-xs text-warn">{err}</p>}
        <button
          onClick={resolveByCoords}
          className="mt-2 text-xs text-ink-faint underline-offset-2 hover:underline"
        >
          或再试一次自动定位
        </button>
      </div>
    );
  }

  // 正常
  return (
    <div className="card animate-fade-in px-5 py-4">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>此刻 · {ctx.city}</Eyebrow>
          <div className="mt-1.5 flex items-baseline gap-3">
            <span className="tnum text-3xl leading-none text-ink">{Math.round(ctx.tempC)}°</span>
            <span className="text-sm text-ink-soft">{ctx.weatherText}</span>
          </div>
          <p className="mt-2 text-[0.78rem] text-ink-faint">
            湿度 {Math.round(ctx.humidity)}% · 体感{FEEL_ZH[ctx.feel]} ·{" "}
            {ctx.daypart === "day" ? "白天" : "夜晚"} · {SEASON_ZH[ctx.season]}季
          </p>
        </div>
        <button
          onClick={() => setEditing((v) => !v)}
          className="chip px-3 py-1 text-xs"
          aria-label="切换城市"
        >
          换地点
        </button>
      </div>
      {editing && (
        <form onSubmit={submitCity} className="mt-3 flex gap-2">
          <input
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            placeholder="输入城市名"
            className="flex-1 rounded-lg border border-line bg-sunken px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button type="submit" disabled={busy} className="rounded-lg bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50">
            {busy ? "…" : "确定"}
          </button>
        </form>
      )}
      {editing && err && <p className="mt-2 text-xs text-warn">{err}</p>}
    </div>
  );
}
