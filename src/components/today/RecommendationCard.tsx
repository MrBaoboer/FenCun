"use client";
import { Eyebrow, EvidenceBar, AccordBar, Stat } from "@/components/ui";
import {
  DISTANCE_LABEL,
  DISTANCE_HINT,
  durationShort,
  genderLabel,
  nameParts,
} from "@/lib/format";
import type { ScoredPick, Context } from "@/lib/types";

function NotesTiers({ notes }: { notes: ScoredPick["perfume"]["notes"] }) {
  const tiers: [string, string[]][] = [
    ["前调", notes.top],
    ["中调", notes.middle],
    ["后调", notes.base],
  ];
  const shown = tiers.filter(([, arr]) => arr.length > 0);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow className="eyebrow-mute">气味档案</Eyebrow>
      {shown.map(([label, arr]) => (
        <div key={label} className="flex gap-3 text-[0.84rem]">
          <span className="serif w-9 shrink-0 text-ink-faint">{label}</span>
          <span className="serif text-ink-soft">{arr.join("、")}</span>
        </div>
      ))}
    </div>
  );
}

export function RecommendationCard({
  pick,
  ctx,
  isSelected,
  explainText,
  explainLoading,
  explainSource,
  onChangeBottle,
  onReset,
}: {
  pick: ScoredPick;
  ctx: Context;
  isSelected: boolean;
  explainText: string;
  explainLoading: boolean;
  explainSource: string;
  onChangeBottle: () => void;
  onReset: () => void;
}) {
  const p = pick.perfume;
  const np = nameParts(p);
  const tier = pick.usage.socialDistance;
  const weatherNorm = Math.max(0, Math.min(1, (pick.breakdown.weather - 0.7) / 0.6));
  const seasonZh = ctx.season === "summer" ? "夏" : ctx.season === "winter" ? "冬" : ctx.season === "spring" ? "春" : "秋";

  return (
    <article key={p.id} className="card animate-fade-up p-6">
      {/* 眉标 */}
      <div className="flex items-center justify-between">
        <Eyebrow>
          {isSelected ? "你选了 · Your Pick" : ctx.daypart === "night" ? "今夜一喷 · Tonight" : "今日一喷 · Today"}
        </Eyebrow>
        {pick.verdict === "avoid" ? (
          <span className="flex items-center gap-1.5 rounded-pill bg-warn-wash px-2.5 py-1 text-[0.68rem] font-semibold text-warn">
            <span className="h-1.5 w-1.5 rounded-full bg-warn" />
            今天不建议
          </span>
        ) : pick.verdict === "caution" ? (
          <span className="flex items-center gap-1.5 text-[0.7rem] text-warn">
            <span className="h-1.5 w-1.5 rounded-full bg-warn" />
            有一点要留意
          </span>
        ) : null}
      </div>

      {/* 香名 */}
      <h2
        className={`mt-3 text-[2.15rem] leading-[1.08] text-ink ${
          np.primaryIsZh ? "serif font-bold tracking-[0.01em]" : "disp font-semibold"
        }`}
      >
        {np.primary}
      </h2>
      {np.secondary && <p className="en-italic mt-1.5 text-[1.15rem]">{np.secondary}</p>}
      <p className="mt-2.5 text-[0.8rem] text-ink-faint">
        {p.brandZh} · {genderLabel(p.gender)}
        {p.year ? ` · ${p.year}` : ""}
        {p.styleTags[0] && <span className="text-ink-soft">　—　{p.styleTags.join(" · ")}</span>}
      </p>

      {/* AI 解读 —— 金边引文 */}
      <div className="mt-5 border-l-2 pl-4" style={{ borderColor: "var(--color-accent)" }}>
        <p
          className={`serif text-[1rem] font-medium leading-[1.85] text-ink-soft transition-opacity duration-300 ${
            explainLoading ? "opacity-55" : "opacity-100"
          }`}
        >
          {explainText || pick.reasons[0]}
        </p>
        <div className="mt-2.5">
          <Eyebrow>
            {explainLoading
              ? "氛寸正在斟酌措辞…"
              : explainSource === "deepseek"
              ? "氛寸 · 此刻为你解读"
              : "氛寸 · 用香建议"}
          </Eyebrow>
        </div>
      </div>

      {/* 规格行 —— 规则线包裹 */}
      <div className="mt-6 flex border-b border-line border-t-2 border-t-ink py-4">
        <div className="flex-1">
          <Stat label="喷量" value={pick.usage.spraysLabel} sub="先少后补" />
        </div>
        <div className="flex-1 border-l border-line">
          <Stat label="社交距离" value={DISTANCE_LABEL[tier]} sub="近身可感" />
        </div>
        <div className="flex-1 border-l border-line">
          <Stat label="留香" value={durationShort(p.longevity)} sub="今日预估" />
        </div>
      </div>

      {/* 分寸建议（展开） */}
      <details className="group mt-3">
        <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 py-2.5 text-[0.78rem] tracking-[0.12em] text-ink-faint transition-colors hover:text-ink-soft [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">展开分寸建议</span>
          <span className="hidden group-open:inline">收起</span>
          <svg width="11" height="11" viewBox="0 0 24 24" className="transition-transform group-open:rotate-180">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
        </summary>

        <div className="flex flex-col gap-5 pb-2 pt-3">
          <div className="flex flex-col gap-2.5 text-[0.86rem]">
            <DetailRow label="喷在哪" value={pick.usage.placement.join("、")} />
            <DetailRow label="社交距离" value={`${DISTANCE_LABEL[tier]}（${DISTANCE_HINT[tier]}）`} />
            <DetailRow label="留香" value={pick.usage.durationHint} />
          </div>

          {pick.risks.length > 0 && (
            <div className="border-l-2 pl-4" style={{ borderColor: "var(--color-warn)" }}>
              <Eyebrow className="!text-warn">分寸提醒</Eyebrow>
              <ul className="mt-1.5 flex flex-col gap-1">
                {pick.risks.map((r, i) => (
                  <li key={i} className="serif text-[0.84rem] leading-relaxed text-ink-soft">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Eyebrow className="eyebrow-mute">为什么是这些建议</Eyebrow>
            <EvidenceBar label="季节匹配" value={pick.breakdown.season} hint={`社区在${seasonZh}季的投票占比`} tone="accent" />
            <EvidenceBar label="场合贴合" value={pick.breakdown.occasion} tone="accent" />
            <EvidenceBar
              label="天气适应"
              value={weatherNorm}
              tone={pick.breakdown.weather < 0.95 ? "warn" : "accent"}
              hint={pick.breakdown.weather >= 1.05 ? "今天更通透" : pick.breakdown.weather <= 0.95 ? "今天偏厚" : ""}
            />
          </div>

          <div className="flex flex-col gap-2.5">
            <Eyebrow className="eyebrow-mute">主香调</Eyebrow>
            {p.accords.slice(0, 5).map((a) => (
              <AccordBar key={a.en} zh={a.zh} strength={a.strength} />
            ))}
          </div>

          <NotesTiers notes={p.notes} />
        </div>
      </details>

      {/* 操作 */}
      <div className="mt-4 flex gap-2.5">
        {isSelected && (
          <button onClick={onReset} className="btn-ghost flex-1 py-3.5 text-[0.85rem]">
            回到今日推荐
          </button>
        )}
        <button onClick={onChangeBottle} className="btn-primary flex-1 py-3.5 text-[0.9rem]">
          换一瓶
        </button>
      </div>
    </article>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-16 shrink-0 text-ink-faint">{label}</span>
      <span className="serif text-ink-soft">{value}</span>
    </div>
  );
}
