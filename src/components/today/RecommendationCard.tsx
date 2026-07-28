"use client";
import Link from "next/link";
import { Eyebrow, EvidenceBar, AccordBar, Stat } from "@/components/ui";
import {
  DISTANCE_LABEL,
  DISTANCE_HINT,
  DISTANCE_ATTRIB,
  DISTANCE_SUB,
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
  libCount,
  allAvoid,
}: {
  pick: ScoredPick;
  ctx: Context;
  isSelected: boolean;
  explainText: string;
  explainLoading: boolean;
  explainSource: string;
  onChangeBottle: () => void;
  onReset: () => void;
  libCount: number;
  /** 柜里今天一瓶合适的都没有——眉标与提示语跟着换（见 recommend.ts 的 allAvoid） */
  allAvoid: boolean;
}) {
  const p = pick.perfume;
  const np = nameParts(p);
  const tier = pick.usage.socialDistance;
  // 无香场合（就医/探病）：建议是"今天不用"，规格行与分寸建议整块不该出现
  const noFragrance = pick.usage.sprays[1] === 0;
  const weatherNorm = Math.max(0, Math.min(1, (pick.breakdown.weather - 0.7) / 0.6));

  return (
    <article key={p.id} className="card animate-fade-up p-6">
      {/* 眉标 + 右上角操作图标 */}
      <div className="flex items-center justify-between gap-3">
        {/* 柜里今天一瓶合适的都没有时，绝不能继续叫「今日之选」——
            那会让眉标说"选它"、正文说"别用它"、下面照挂喷量与留香，是同一张卡自己打自己。
            依然给出"真要用就这么用"的那一瓶，但把它称作什么，得跟着结论走。 */}
        <Eyebrow>
          {isSelected
            ? "你选了 · Your Pick"
            : allAvoid
              ? "今天柜里没有合适的 · None Today"
              : ctx.daypart === "night"
                ? "今夜之选 · Tonight"
                : "今日之选 · Today"}
        </Eyebrow>
        <div className="flex shrink-0 items-center gap-3">
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
          {isSelected ? (
            <button onClick={onReset} aria-label="回到今日之选" title="回到今日之选" className="relative -mr-1 p-1 text-ink-faint transition-colors after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:text-accent">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M9 7L4 12l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 12h11a5 5 0 0 1 0 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : libCount > 1 ? (
            <button onClick={onChangeBottle} aria-label="换一瓶" title="换一瓶" className="relative -mr-1 p-1 text-ink-faint transition-colors after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:text-accent">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M5 8h14M16 5l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M19 16H5M8 13l-3 3 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <Link href="/library" aria-label="再加一瓶" title="再加一瓶" className="relative -mr-1 p-1 text-ink-faint transition-colors after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:text-accent">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </Link>
          )}
        </div>
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
      {allAvoid && !isSelected && (
        <p className="serif mt-2.5 text-[0.85rem] leading-relaxed text-warn">
          下面这瓶是相对最稳的一瓶
        </p>
      )}
      <p className="mt-2.5 text-[0.8rem] text-ink-faint">
        {p.brandZh} · {genderLabel(p.gender)}
        {p.year ? ` · ${p.year}` : ""}
        {p.styleTags[0] && <span className="text-ink-soft">　—　{p.styleTags.join(" · ")}</span>}
      </p>

      {/* AI 解读 —— 金边引文 */}
      <div className="mt-5 border-l-2 pl-4" style={{ borderColor: "var(--color-accent)" }}>
        {/* 加载态的透明度到 55% 时，明韵下这段 16px/500 正文实测只有 4.18:1，
            低于 WCAG AA 的 4.5（它不属于大字：需要 18.66px 粗体或 24px）。
            而"在斟酌"这件事下面那行眉标已经说清了，正文没必要为此变得读不清。
            解读措辞落定时补播一次——这一整块是换场合/换瓶后唯一会变的正文。 */}
        <p
          aria-live="polite"
          className={`serif text-[1rem] font-medium leading-[1.85] text-ink-soft transition-opacity duration-300 ${
            explainLoading ? "opacity-70" : "opacity-100"
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

      {/* 无香场合：答案是"今天不用"，就不该再摆喷量/社交距离/留香三个规格——
          那和「今天不建议用它」下面挂着「喷 2 下」是同一种自相矛盾。只留一句话。 */}
      {noFragrance ? (
        <div className="mt-6 border-t-2 border-t-ink pt-4">
          <Eyebrow className="!text-warn">今天的分寸 · 不用香</Eyebrow>
          <p className="serif mt-2 text-[0.95rem] leading-relaxed text-ink-soft">{pick.usage.note}</p>
          <p className="serif mt-2 text-[0.84rem] leading-relaxed text-ink-faint">
            {pick.usage.durationHint}
          </p>
        </div>
      ) : (
        <>
      {/* 规格行 —— 规则线包裹 */}
      <div className="mt-6 flex border-b border-line border-t-2 border-t-ink py-4">
        <div className="flex-1">
          <Stat label="喷量" value={pick.usage.spraysLabel} sub="先少后补" />
        </div>
        <div className="flex-1 border-l border-line">
          <Stat label="社交距离" value={DISTANCE_LABEL[tier]} sub={DISTANCE_SUB[tier]} />
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
            {/* 归因：这一档来自社区评价者的主观投票，不是测量值 */}
            <DetailRow
              label="社交距离"
              value={`${DISTANCE_LABEL[tier]} · ${DISTANCE_ATTRIB}（${DISTANCE_HINT[tier]}）`}
            />
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
            {/* 季节分是 seasonFit（以主场季为基准、按票数收缩），不是投票占比；无数据香不冒称「社区」 */}
            <EvidenceBar label="季节匹配" value={pick.breakdown.season} hint={p.custom || p.lowVotes ? undefined : "以它的主场季为满格"} tone="accent" />
            <EvidenceBar label="场合贴合" value={pick.breakdown.occasion} tone="accent" />
            <EvidenceBar
              label="天气适应"
              value={weatherNorm}
              tone={pick.breakdown.weather < 0.95 ? "warn" : "accent"}
              hint={pick.breakdown.weather >= 1.05 ? "天气帮它加分" : pick.breakdown.weather <= 0.95 ? "天气让它吃亏" : ""}
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
        </>
      )}
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
