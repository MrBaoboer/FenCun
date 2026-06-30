"use client";
import { Eyebrow, EvidenceBar, AccordBar, Stat } from "@/components/ui";
import {
  DISTANCE_LABEL,
  DISTANCE_HINT,
  durationShort,
  SILLAGE_WORD,
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
      <Eyebrow>气味档案</Eyebrow>
      {shown.map(([label, arr]) => (
        <div key={label} className="flex gap-3 text-[0.82rem]">
          <span className="w-9 shrink-0 text-ink-faint">{label}</span>
          <span className="text-ink-soft">{arr.join(" · ")}</span>
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
  const tier = pick.usage.socialDistance;
  const weatherNorm = Math.max(0, Math.min(1, (pick.breakdown.weather - 0.7) / 0.6));

  return (
    <article key={p.id} className="card animate-fade-up overflow-hidden">
      {/* 头部 */}
      <div className="px-6 pt-6">
        <div className="flex items-center justify-between">
          <Eyebrow>{isSelected ? "你选了 · Your Pick" : "今日一喷 · Today"}</Eyebrow>
          {!pick.usage.suitable && (
            <span className="flex items-center gap-1 text-[0.7rem] text-warn">
              <span className="h-1.5 w-1.5 rounded-full bg-warn" />
              有一点要留意
            </span>
          )}
        </div>
        {(() => {
          const np = nameParts(p);
          return (
            <>
              <h2
                className={`mt-3 text-[1.7rem] font-medium leading-tight text-ink ${
                  np.primaryIsZh ? "tracking-tight" : "font-display"
                }`}
              >
                {np.primary}
              </h2>
              {np.secondary && (
                <p className="mt-0.5 font-display text-[0.98rem] italic text-ink-faint">
                  {np.secondary}
                </p>
              )}
            </>
          );
        })()}
        <p className="mt-1.5 text-sm text-ink-soft">
          {p.brandZh} · {genderLabel(p.gender)}
          {p.year ? ` · ${p.year}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {p.styleTags.map((tag) => (
            <span
              key={tag}
              className="rounded-pill bg-brand-wash px-2.5 py-0.5 text-[0.72rem] text-brand"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* AI 解读 */}
      <div className="mx-6 mt-5 rounded-lg bg-paper-deep/70 px-4 py-3.5">
        <p
          className={`text-[0.93rem] leading-relaxed text-ink transition-opacity duration-300 ${
            explainLoading ? "opacity-60" : "opacity-100"
          }`}
        >
          {explainText || pick.reasons[0]}
        </p>
        <div className="mt-2">
          <Eyebrow>
            {explainLoading
              ? "氛寸正在斟酌措辞…"
              : explainSource === "deepseek"
              ? "氛寸 · 此刻为你解读"
              : "氛寸 · 用香建议"}
          </Eyebrow>
        </div>
      </div>

      {/* 用香三件套 */}
      <div className="mx-6 mt-5 grid grid-cols-3 divide-x divide-line rounded-lg border border-line py-4">
        <Stat label="喷量" value={pick.usage.spraysLabel} sub="先少后补" />
        <Stat label="社交距离" value={SILLAGE_WORD[tier]} sub={DISTANCE_LABEL[tier]} />
        <Stat label="留香" value={durationShort(p.longevity)} />
      </div>

      {/* 分寸建议（展开） */}
      <details className="group mx-6 mt-3">
        <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 py-2 text-[0.82rem] text-ink-faint transition-colors hover:text-ink-soft [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">展开分寸建议</span>
          <span className="hidden group-open:inline">收起</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            className="transition-transform group-open:rotate-180"
          >
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
        </summary>

        <div className="flex flex-col gap-5 pb-2 pt-2">
          <div className="flex flex-col gap-2.5 text-[0.86rem]">
            <DetailRow label="喷在哪" value={pick.usage.placement.join("、")} />
            <DetailRow
              label="社交距离"
              value={`${DISTANCE_LABEL[tier]}（${DISTANCE_HINT[tier]}）`}
            />
            <DetailRow label="留香" value={pick.usage.durationHint} />
          </div>

          {pick.risks.length > 0 && (
            <div className="rounded-lg bg-warn-wash px-4 py-3">
              <Eyebrow className="!text-warn">分寸提醒</Eyebrow>
              <ul className="mt-1.5 flex flex-col gap-1">
                {pick.risks.map((r, i) => (
                  <li key={i} className="text-[0.82rem] leading-snug text-ink-soft">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Eyebrow>为什么是这些建议</Eyebrow>
            <EvidenceBar
              label="季节匹配"
              value={pick.breakdown.season}
              hint={`社区在${ctx.season === "summer" ? "夏" : ctx.season === "winter" ? "冬" : ctx.season === "spring" ? "春" : "秋"}季的投票占比`}
            />
            <EvidenceBar label="场合贴合" value={pick.breakdown.occasion} />
            <EvidenceBar
              label="天气适应"
              value={weatherNorm}
              tone={pick.breakdown.weather < 0.95 ? "warn" : "brand"}
              hint={pick.breakdown.weather >= 1.05 ? "今天更通透" : pick.breakdown.weather <= 0.95 ? "今天偏厚" : ""}
            />
          </div>

          <div className="flex flex-col gap-2.5">
            <Eyebrow>主香调</Eyebrow>
            {p.accords.slice(0, 5).map((a) => (
              <AccordBar key={a.en} zh={a.zh} strength={a.strength} />
            ))}
          </div>

          <NotesTiers notes={p.notes} />
        </div>
      </details>

      {/* 操作 */}
      <div className="mt-4 flex gap-2 border-t border-line px-6 py-4">
        {isSelected && (
          <button
            onClick={onReset}
            className="flex-1 rounded-lg border border-line py-2.5 text-sm text-ink-soft transition-colors hover:bg-sunken"
          >
            回到今日推荐
          </button>
        )}
        <button
          onClick={onChangeBottle}
          className="flex-1 rounded-lg bg-ink py-2.5 text-sm text-paper transition-opacity hover:opacity-90"
        >
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
      <span className="text-ink-soft">{value}</span>
    </div>
  );
}
