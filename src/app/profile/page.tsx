"use client";
import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { useLibraryPerfumes } from "@/lib/hooks";
import { Eyebrow } from "@/components/ui";
import { OCCASION_LABEL } from "@/lib/format";

export default function ProfilePage() {
  const lib = useLibraryPerfumes();
  const feedbacks = useStore((s) => s.feedbacks);
  const hydrated = useStore((s) => s.hydrated);

  // 偏好画像：从反馈里读出"全局硬偏移"（简单可感，不需大数据）
  const learned = useMemo(() => {
    const strong = feedbacks.filter((f) => f.rating === "too_strong").length;
    const weak = feedbacks.filter((f) => f.rating === "too_weak").length;
    const lines: string[] = [];
    if (strong >= 3) lines.push("你多次觉得偏冲——氛寸已默认帮你调低扩散与喷量建议。");
    else if (strong > 0) lines.push("你偶尔觉得偏冲，氛寸在慢慢学着帮你收一点。");
    if (weak >= 3) lines.push("你多次觉得偏淡——氛寸会建议你略增喷量或选更持久的。");
    if (lines.length === 0) lines.push("多给几次「今天，刚好吗」的反馈，氛寸就会越来越懂你的分寸。");
    return lines;
  }, [feedbacks]);

  const recent = useMemo(
    () => [...feedbacks].sort((a, b) => b.at - a.at).slice(0, 8),
    [feedbacks]
  );
  const byId = useMemo(() => new Map(lib.map((p) => [p.id, p])), [lib]);

  const RATING_ZH: Record<string, string> = {
    too_weak: "偏淡",
    perfect: "刚好",
    too_strong: "偏冲",
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="px-1">
        <Eyebrow>我的 · Me</Eyebrow>
        <h1 className="mt-1 text-2xl font-medium tracking-tight text-ink">我的分寸</h1>
      </header>

      {/* 统计 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card flex flex-col items-start px-5 py-4">
          <span className="eyebrow">在柜香水</span>
          <span className="tnum mt-1 text-3xl text-ink">{hydrated ? lib.length : "—"}</span>
        </div>
        <div className="card flex flex-col items-start px-5 py-4">
          <span className="eyebrow">用香反馈</span>
          <span className="tnum mt-1 text-3xl text-ink">
            {hydrated ? feedbacks.length : "—"}
          </span>
        </div>
      </div>

      {/* 偏好画像 */}
      <div className="card px-5 py-4">
        <Eyebrow>氛寸学到的偏好</Eyebrow>
        <div className="mt-2.5 flex flex-col gap-2">
          {learned.map((l, i) => (
            <p key={i} className="text-sm leading-relaxed text-ink-soft">
              {l}
            </p>
          ))}
        </div>
      </div>

      {/* 用香记录 */}
      {recent.length > 0 && (
        <div className="card px-5 py-4">
          <Eyebrow>用香记录</Eyebrow>
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {recent.map((f, i) => {
              const p = byId.get(f.perfumeId);
              return (
                <li key={i} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="truncate text-ink">{p ? p.nameZh || p.name : "已移出的香水"}</span>
                    <span className="ml-2 text-[0.72rem] text-ink-faint">
                      {OCCASION_LABEL[f.context.occasion] ?? f.context.occasion} ·{" "}
                      {Math.round(f.context.tempC)}°
                    </span>
                  </div>
                  <span className="shrink-0 rounded-pill bg-sunken px-2.5 py-0.5 text-[0.72rem] text-ink-soft">
                    {RATING_ZH[f.rating]}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 关于 */}
      <div className="card px-5 py-4">
        <Eyebrow>关于氛寸的分寸</Eyebrow>
        <p className="mt-2 text-[0.82rem] leading-relaxed text-ink-soft">
          推荐与用法来自约 3.6 万款香水的真实社区投票数据（扩散、留香、四季、日夜、香调）。
          氛寸刻意不给「留香 6.2 小时」这类伪精确数字——留香、喷量、社交距离一律用区间与档位，
          因为无法验证的精确，会摧毁信任。
        </p>
      </div>
    </div>
  );
}
