"use client";
import { Eyebrow, AccordBar } from "@/components/ui";
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
      <Eyebrow className="eyebrow-mute">气味档案</Eyebrow>
      {shown.map(([label, a]) => (
        <div key={label} className="flex gap-3 text-[0.86rem]">
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
      <span className="eyebrow eyebrow-mute !text-[0.56rem]">{label}</span>
      <span className="serif text-[0.98rem] font-bold text-ink">{value}</span>
    </div>
  );
}

export function PerfumeCard({ p, onClose }: { p: Perfume | null; onClose: () => void }) {
  if (!p) return null;
  const np = nameParts(p);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div className="absolute inset-0 animate-fade-in bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="card relative z-10 max-h-[86vh] w-full max-w-md animate-fade-up overflow-y-auto rounded-b-none p-6 shadow-float md:rounded-card">
        <div className="flex items-start justify-between">
          <Eyebrow>香气档案 · Profile</Eyebrow>
          <button onClick={onClose} className="chip serif px-3 py-1 text-xs" aria-label="关闭">
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
            <span key={t} className="serif rounded-pill border border-line-strong px-2.5 py-0.5 text-[0.72rem] text-ink-soft">
              {t}
            </span>
          ))}
        </div>

        <div className="my-5 grid grid-cols-4 gap-2 border-y border-line py-4">
          <Stat label="扩散" value={SILLAGE_WORD[p.sillageTier]} />
          <Stat label="留香" value={durationShort(p.longevity)} />
          <Stat label="适合季节" value={seasonSummary(p)} />
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

        <p className="mt-5 text-[0.72rem] leading-relaxed text-ink-faint">
          社交距离约「{DISTANCE_LABEL[p.sillageTier]}」。数据来自社区投票，浓度等未标注项以官方为准。
        </p>
      </div>
    </div>
  );
}
