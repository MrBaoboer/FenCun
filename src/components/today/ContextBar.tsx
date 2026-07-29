"use client";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Eyebrow } from "@/components/ui";
import { OccasionChips } from "@/components/today/OccasionChips";
import { SceneInput } from "@/components/today/SceneInput";
import { FEEL_ZH, mustyAir } from "@/lib/season";
import { weatherGreeting } from "@/lib/greeting";
import type { Context } from "@/lib/types";

// 这一页是静态预渲染的：在渲染期直接读 new Date()，服务端拿到的是**构建时**那一天，
// 会被烘进 HTML，直到 hydration 才被客户端的真实日期替换——用户每次打开都先闪一下过期日期。
// 改为挂载后再求值：首帧留空，永远不显示一个错误的日期。
function useDateLabel(tick: number): string {
  const [label, setLabel] = useState("");
  useEffect(() => {
    try {
      setLabel(
        new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date())
      );
    } catch {
      setLabel("今天");
    }
  }, [tick]); // 跟随 AppProvider 的分钟节拍：长开标签页跨午夜时日期会自己翻页
  return label;
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
    else setErr("没找到这个城市，换个写法试试。");
  }
  return (
    <>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={cityInput}
          onChange={(e) => setCityInput(e.target.value)}
          placeholder="例如：上海、杭州、成都"
          // min-w-0 不能省：flex 子项的默认 min-width 是 auto，撑到内容宽度就不再收缩。
          // 这里的 placeholder 有 11 个汉字，而 globals.css 又把 input 的字号钉在 16px
          //（防 iOS 聚焦缩放），于是 320px 宽的手机上「确定」按钮会被挤出卡片。
          // 定位被拒之后，这个表单是唯一的补救入口。
          className="serif min-w-0 flex-1 border-b border-field bg-transparent px-1 py-2 text-sm text-ink focus:border-accent"
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
  const { locState, resolveByCoords, nowMinute } = useApp();
  const [editing, setEditing] = useState(false);
  const dateText = useDateLabel(nowMinute);

  return (
    <div className="card animate-fade-in px-5 py-5">
      {/* 顶行：此刻 + 日期 */}
      <div className="flex items-center justify-between">
        <Eyebrow>此刻 · Now</Eyebrow>
        <span className="disp text-[0.74rem] tracking-[0.1em] text-ink-faint">{dateText}</span>
      </div>

      {ctx && !ctx.approximate ? (
        <>
          {/* aria-label 会整体替换可访问名，把 {ctx.city} 盖掉——而全页只有这一个节点
              显示当前是哪座城。读屏用户拿到一份「按此刻天气挑的香」，却听不到这个「此刻」
              是哪里的天气；首次到访者默认落在北京，这恰恰是最需要能核对的一项。
              热区：这一行只有 23.5px 高，卡在 WCAG 2.5.8 AA 的 24px 线上，用伪元素补足。 */}
          <button
            onClick={() => setEditing((v) => !v)}
            className="group relative mt-3 flex items-center gap-1.5 after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-['']"
            aria-label={`当前城市 ${ctx.city}，点击切换`}
            aria-expanded={editing}
          >
            <LocationPin />
            <span className="serif text-[1rem] font-semibold text-ink group-hover:text-accent">
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
              <p className="mt-2 text-[0.8rem] text-ink-faint">
                湿度 {Math.round(ctx.humidity)}% · 体感{FEEL_ZH[ctx.feel]}
              </p>
              {/* 回南天：不改打分，只说一句真正有用的。香水盖不住衣物本身的霉潮底味 */}
              {mustyAir(ctx.tempC, ctx.humidity) && (
                <p className="serif mt-1.5 text-[0.8rem] leading-relaxed text-ink-faint">
                  这种回潮天，先闻一下要穿的那件衣服——香水盖不住霉潮的底味。
                </p>
              )}
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
      ) : /* idle 是**过渡态**，不是失败：此前它没有分支接住，直接落到「没拿到你的位置」，
             而这一帧还被烘进了静态预渲染 HTML。于是每一次冷启动，用户读到的第一句话
             都是一句关于他自己的假话，旁边还配着一个要他手填城市的输入框——
             对从简历或 GitHub 点进来的人，这就是门面第一屏。
             它不会卡死：store 的 onRehydrateStorage 在成功与失败两条路上都会置
             hydrated，AppProvider 的 effect 必然走到 fetchByCity 或 resolveByCoords 之一。 */
      locState === "locating" || locState === "idle" ? (
        <p className="serif mt-3 text-sm text-ink-faint">正在感知此刻的天气…</p>
      ) : (
        <div className="mt-2">
          <div className="flex items-center gap-1.5">
            <LocationPin />
            <span className="serif text-[0.95rem] font-medium text-ink-soft">没拿到你的位置</span>
          </div>
          <CityForm onDone={() => {}} />
          {/* 全站唯一没补热区的控件，实测只有 16px 高（WCAG 2.5.8 AA 要求 24px），
              而它恰好在"定位失败"这条恢复路径上——最需要点得中的时候最难点中。
              同文件其余图标按钮用的是 after:h-11 w-11 的伪元素扩展，这里换成 py-1.5：
              它是行内文字按钮，撑高自身比盖一层 44px 命中区更不容易压到相邻元素。 */}
          <button
            onClick={() => resolveByCoords()}
            className="mt-2 py-1.5 text-xs text-ink-faint underline-offset-2 hover:underline"
          >
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
