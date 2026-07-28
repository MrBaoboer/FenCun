"use client";
// 香历——被气味标记的生活流水。系统自动生成骨架（哪天·什么天气·喷了什么·感觉如何），
// 用户零写作负担；留白不谴责：无香的日子也是分寸，绝无「断签」概念。
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { monthGrid, dateKey, familyColor } from "@/lib/journal";
import { OCCASION_LABEL } from "@/lib/format";
import { Eyebrow } from "@/components/ui";
import type { WearEntry } from "@/lib/types";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const RATING_ZH: Record<string, string> = {
  too_weak: "淡了点",
  perfect: "刚好",
  too_strong: "太冲了",
  scene_mismatch: "不合场合",
};

export default function JournalPage() {
  const hydrated = useStore((s) => s.hydrated);
  const wearLog = useStore((s) => s.wearLog);
  const feedbacks = useStore((s) => s.feedbacks);
  const setWearNote = useStore((s) => s.setWearNote);

  const now = new Date();
  const todayKey = dateKey(now.getTime());
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState<string>(todayKey);

  const byDay = useMemo(() => new Map(wearLog.map((e) => [e.d, e])), [wearLog]);
  const weeks = useMemo(() => monthGrid(view.y, view.m), [view]);
  const isCurrentMonth = view.y === now.getFullYear() && view.m === now.getMonth();

  const keyOf = (day: number) =>
    `${view.y}-${String(view.m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // 本月小结：记了几天、最常穿哪瓶（不做打卡，不做成就——只是陈述）
  const monthStats = useMemo(() => {
    const prefix = `${view.y}-${String(view.m + 1).padStart(2, "0")}-`;
    const entries = wearLog.filter((e) => e.d.startsWith(prefix));
    if (entries.length === 0) return null;
    const count = new Map<string, number>();
    for (const e of entries) count.set(e.name, (count.get(e.name) ?? 0) + 1);
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    return { days: entries.length, topName: top[0], topCount: top[1] };
  }, [wearLog, view]);

  const entry = byDay.get(selected) ?? null;

  if (!hydrated) return <div className="h-72 animate-pulse bg-sunken/50" />;

  return (
    <div className="flex flex-col gap-5">
      {/* 同今日页：月份那一行是 h2（它随翻页变），页面本身的标题用视觉隐藏的 h1 补齐 */}
      <h1 className="sr-only">香历 · 你的穿香记录</h1>
      {/* 月导航 */}
      <div className="card px-5 py-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}
            aria-label="上个月"
            className="relative px-2 py-1 text-[1.05rem] text-ink-faint transition-colors after:absolute after:-inset-2 hover:text-ink"
          >
            ‹
          </button>
          <h2 className="serif text-[1.05rem] font-bold text-ink">
            {view.y} 年 {view.m + 1} 月
          </h2>
          <button
            onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}
            disabled={isCurrentMonth}
            aria-label="下个月"
            className="relative px-2 py-1 text-[1.05rem] text-ink-faint transition-colors after:absolute after:-inset-2 hover:text-ink disabled:opacity-30 disabled:hover:text-ink-faint"
          >
            ›
          </button>
        </div>

        {/* 星期头 */}
        <div className="mt-4 grid grid-cols-7 text-center">
          {WEEKDAYS.map((w) => (
            <span key={w} className="text-[0.68rem] uppercase tracking-wide text-ink-faint">
              {w}
            </span>
          ))}
        </div>

        {/* 月网格：色点 = 当日香水的主香调；留白 = 无香日，不谴责 */}
        <div className="mt-1.5 grid grid-cols-7 gap-y-1">
          {weeks.flat().map((day, i) => {
            if (day == null) return <span key={`x${i}`} />;
            const k = keyOf(day);
            const e = byDay.get(k);
            const isToday = k === todayKey;
            const isSelected = k === selected;
            const future = k > todayKey;
            return (
              <button
                key={k}
                onClick={() => setSelected(k)}
                disabled={future}
                aria-pressed={isSelected}
                aria-label={`${view.m + 1}月${day}日${e ? ` · ${e.name}` : ""}`}
                // 固定 44×44 塞进 7 列网格：375px 视口下每列只有约 41px，320px 下只有 33px，
                // 相邻两格互相压盖，色点与日期也跟星期头对不齐。
                // 改成按列宽自适应、用 aspect-square 保住方形，并以 min-h 守住
                // WCAG 2.5.8 的 24px 触控下限（不是 44px——那是 AAA 的 2.5.5）。
                className={`mx-auto flex aspect-square w-full min-h-6 max-w-11 flex-col items-center justify-center rounded-md transition-colors ${
                  isSelected ? "bg-sunken" : "hover:bg-sunken/60"
                } ${future ? "opacity-30" : ""}`}
              >
                <span
                  className={`text-[0.82rem] leading-none ${
                    isToday ? "serif font-bold text-accent" : e ? "text-ink" : "text-ink-faint"
                  }`}
                >
                  {day}
                </span>
                <span
                  className="mt-1.5 h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: e ? familyColor(e.fam) : "transparent" }}
                />
              </button>
            );
          })}
        </div>

        {monthStats && (
          <p className="mt-3 border-t border-line pt-3 text-[0.76rem] text-ink-faint">
            本月记香 {monthStats.days} 天 · 最常穿「{monthStats.topName}」
            {monthStats.topCount > 1 ? `（${monthStats.topCount} 次）` : ""}
          </p>
        )}
      </div>

      {/* 当日快照：key=日期 → 切换日期时整组件重挂，note 状态自然重置（不在渲染期 setState） */}
      {entry ? (
        <DaySnapshot
          key={entry.d}
          entry={entry}
          feedback={
            feedbacks.find((f) => f.perfumeId === entry.perfumeId && dateKey(f.at) === entry.d)?.rating ?? null
          }
          onSaveNote={(note) => setWearNote(entry.d, note)}
        />
      ) : (
        <div className="card px-5 py-5">
          <Eyebrow className="eyebrow-mute">{formatDay(selected)}</Eyebrow>
          <p className="serif mt-2 text-[0.9rem] leading-relaxed text-ink-faint">
            {wearLog.length === 0
              ? "香历还空着。从今天的推荐开始——你采纳或反馈的每一瓶，都会自动落在这里。"
              : selected === todayKey
              ? "今天还没记。回「今日」采纳一瓶，或晚点答一句「刚好吗」，这一天就会有颜色。"
              : "这天没有记录。无香的日子，也是分寸。"}
          </p>
        </div>
      )}
    </div>
  );
}

function formatDay(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const week = ["日", "一", "二", "三", "四", "五", "六"][new Date(y, m - 1, day).getDay()];
  return `${m} 月 ${day} 日 · 周${week}`;
}

function DaySnapshot({
  entry,
  feedback,
  onSaveNote,
}: {
  entry: WearEntry;
  feedback: string | null;
  onSaveNote: (note: string) => void;
}) {
  const [note, setNote] = useState(entry.note ?? "");

  const weather =
    entry.tempC != null
      ? `${entry.tempC}℃${entry.weatherText ? ` · ${entry.weatherText}` : ""}`
      : entry.weatherText || null;

  return (
    <div className="card animate-fade-in px-5 py-5">
      <Eyebrow className="eyebrow-mute">{formatDay(entry.d)}</Eyebrow>
      <div className="mt-2.5 flex items-baseline gap-2.5">
        <span
          className="h-2.5 w-2.5 shrink-0 self-center rounded-full"
          style={{ backgroundColor: familyColor(entry.fam) }}
        />
        <h3 className="serif text-[1.25rem] font-bold text-ink">{entry.name}</h3>
      </div>
      <p className="mt-1.5 text-[0.82rem] text-ink-faint">
        {OCCASION_LABEL[entry.occasion] ?? entry.occasion}
        {weather ? ` · ${weather}` : ""}
        {feedback && RATING_ZH[feedback] ? (
          <span className="text-ink-soft"> · 你说「{RATING_ZH[feedback]}」</span>
        ) : null}
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => onSaveNote(note)}
        maxLength={60}
        rows={2}
        placeholder="这天有什么值得记的吗？一句就够。"
        className="serif mt-4 w-full resize-none rounded-md border border-line bg-transparent px-3 py-2 text-[0.88rem] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-accent"
      />
    </div>
  );
}
