// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

"use client";
import { Eyebrow, AccordBar, useDialogA11y } from "@/components/ui";
import { nameParts, genderLabel, SILLAGE_WORD, durationShort, DISTANCE_LABEL } from "@/lib/format";
import type { Perfume } from "@/lib/types";

function seasonSummary(p: Perfume): string {
  const entries: [string, number][] = [
    ["春", p.seasonPct.spring],
    ["夏", p.seasonPct.summer],
    ["秋", p.seasonPct.autumn],
    ["冬", p.seasonPct.winter],
  ];
  const arr = entries.sort((a, b) => b[1] - a[1]);
  if (arr[0][1] - arr[3][1] < 0.09) return "四季皆宜";
  return arr.slice(0, 2).map((s) => s[0]).join("·") + "季";
}
function daypartSummary(p: Perfume): string {
  const d = p.daypartPct.day;
  if (d >= 0.62) return "偏白天";
  if (d <= 0.38) return "偏夜晚";
  return "日夜皆宜";
}

function Tiers({ notes }: { notes: Perfume["notes"] }) {
  const rows: [string, string[]][] = [
    ["前调", notes.top],
    ["中调", notes.middle],
    ["后调", notes.base],
  ];
  const shown = rows.filter(([, a]) => a.length > 0);
  if (!shown.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow className="eyebrow-mute">前中后调</Eyebrow>
      {shown.map(([label, a]) => (
        <div key={label} className="flex gap-3 text-[0.85rem]">
          <span className="serif w-9 shrink-0 text-ink-faint">{label}</span>
          <span className="serif text-ink-soft">{a.join("、")}</span>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      {/* 0.56rem 折合 8.96px，比 globals.css 里被判定为「中文读不动」的 9.28px 还小，
          还叠着 0.24em 字距——322df67 那轮只改了 ui.tsx 那份 Stat，漏了这份局部副本。
          回到 .eyebrow 自己的字号。 */}
      <span className="eyebrow eyebrow-mute">{label}</span>
      <span className="serif text-[1rem] font-bold text-ink">{value}</span>
    </div>
  );
}

export function PerfumeCard({ p, onClose }: { p: Perfume | null; onClose: () => void }) {
  const panelRef = useDialogA11y(!!p, onClose);
  if (!p) return null;
  const np = nameParts(p);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      {/* 遮罩点击关闭；键盘出口由 Esc（useDialogA11y）承担 */}
      <div aria-hidden="true" className="absolute inset-0 animate-fade-in bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`香气档案：${np.primary}`}
        tabIndex={-1}
        // pb 补 iOS 全面屏的底部安全区：不补的话，弹层末尾那几行会压在 Home 指示条底下
        className="card relative z-10 max-h-[86vh] w-full max-w-md animate-fade-up overflow-y-auto rounded-b-none p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] shadow-float outline-none md:rounded-card md:pb-6"
      >
        <div className="flex items-start justify-between">
          <Eyebrow>香气档案 · Profile</Eyebrow>
          <button
            onClick={onClose}
            className="chip serif relative px-3 py-1 text-xs after:absolute after:-inset-2 after:content-['']"
            aria-label="关闭"
          >
            关闭
          </button>
        </div>

        <h2 className={`mt-3 text-[1.9rem] leading-tight text-ink ${np.primaryIsZh ? "serif font-bold" : "disp font-semibold"}`}>
          {np.primary}
        </h2>
        {np.secondary && <p className="en-italic mt-1 text-[1.05rem]">{np.secondary}</p>}
        <p className="mt-2 text-[0.8rem] text-ink-faint">
          {p.brandZh} · {genderLabel(p.gender)}
          {p.year ? ` · ${p.year}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {p.styleTags.map((t) => (
            <span key={t} className="serif rounded-pill border border-line-strong px-2.5 py-0.5 text-[0.74rem] text-ink-soft">
              {t}
            </span>
          ))}
        </div>

        <div className="my-5 grid grid-cols-4 gap-2 border-y border-line py-4">
          <Stat label="社交距离" value={SILLAGE_WORD[p.sillageTier]} />
          <Stat label="留香" value={durationShort(p.longevity)} />
          <Stat label="季节" value={seasonSummary(p)} />
          <Stat label="时段" value={daypartSummary(p)} />
        </div>

        <div className="flex flex-col gap-2.5">
          <Eyebrow className="eyebrow-mute">主香调</Eyebrow>
          {p.accords.slice(0, 6).map((a) => (
            <AccordBar key={a.en} zh={a.zh} strength={a.strength} />
          ))}
        </div>

        <div className="mt-5">
          <Tiers notes={p.notes} />
        </div>

        {/* 归因随「这一档背后有没有票」变。手动记的那瓶是用户自己勾的档，
            国货白名单里 sillage 为 null 的那 444 条则一票都没有——
            对这两类说「来自社区投票」是凭空造了一份不存在的数据 */}
        <p className="mt-5 text-[0.74rem] leading-relaxed text-ink-faint">
          社交距离「{DISTANCE_LABEL[p.sillageTier]}」
          {p.custom
            ? "是你自己填的"
            : p.lowVotes || p.sillage == null
              ? "只是估计，这瓶投票的人还少"
              : "来自社区投票"}
          。
        </p>
      </div>
    </div>
  );
}
