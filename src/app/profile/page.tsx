"use client";
import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { useLibraryPerfumes } from "@/lib/hooks";
import { aggregateBias } from "@/lib/recommend";
import { Eyebrow } from "@/components/ui";
import { OCCASION_LABEL } from "@/lib/format";

export default function ProfilePage() {
  const lib = useLibraryPerfumes();
  const feedbacks = useStore((s) => s.feedbacks);
  const hydrated = useStore((s) => s.hydrated);
  const swapCount = useStore((s) => s.swapCount);
  const dustyAdoptCount = useStore((s) => s.dustyAdoptCount);
  const exportData = useStore((s) => s.exportData);
  const importData = useStore((s) => s.importData);

  function doExport() {
    const blob = new Blob([exportData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `氛寸香柜-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function doImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const ok = importData(String(reader.result));
      if (!ok) alert("导入失败：文件格式不对，请选择氛寸导出的 JSON。");
    };
    reader.readAsText(file);
  }

  // 偏好画像：按"每瓶各自的反馈"聚合（与打分/用法引擎口径一致——偏移是单香维度的，不是全局默认）
  const learned = useMemo(() => {
    const bias = aggregateBias(feedbacks);
    let strongN = 0;
    let weakN = 0;
    for (const b of bias.values()) {
      if (b.perceivedStrength >= 0.4) strongN++;
      else if (b.perceivedStrength <= -0.4) weakN++;
    }
    const lines: string[] = [];
    if (strongN > 0)
      lines.push(`有 ${strongN} 瓶你反馈过偏冲——推荐它们时，氛寸已按你的反馈各自帮你收一点喷量与扩散。`);
    if (weakN > 0)
      lines.push(`有 ${weakN} 瓶你反馈过偏淡——推荐它们时，氛寸会建议略增喷量。`);
    if (lines.length === 0)
      lines.push("多给几次「今天，刚好吗」的反馈，氛寸就会越来越懂你对每瓶的分寸。");
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
      <header className="pb-1">
        <Eyebrow>我的 · Me</Eyebrow>
        <h1 className="serif mt-1.5 text-[1.7rem] font-bold text-ink">我的分寸</h1>
      </header>

      {/* 统计 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card px-5 py-4">
          <span className="eyebrow eyebrow-mute">在柜香水</span>
          <div className="disp mt-2 text-[2.4rem] font-normal leading-none text-ink">
            {hydrated ? lib.length : "—"}
          </div>
        </div>
        <div className="card px-5 py-4">
          <span className="eyebrow eyebrow-mute">用香反馈</span>
          <div className="disp mt-2 text-[2.4rem] font-normal leading-none text-ink">
            {hydrated ? feedbacks.length : "—"}
          </div>
        </div>
      </div>

      {/* 偏好画像 */}
      <div className="card px-5 py-4">
        <Eyebrow>氛寸学到的偏好</Eyebrow>
        <div className="mt-3 flex flex-col gap-2">
          {learned.map((l, i) => (
            <p key={i} className="serif text-[0.95rem] font-medium leading-relaxed text-ink-soft">
              {l}
            </p>
          ))}
        </div>
      </div>

      {/* 用香记录 */}
      {recent.length > 0 && (
        <div className="card px-5 py-4">
          <Eyebrow>用香记录</Eyebrow>
          <ul className="mt-1 flex flex-col">
            {recent.map((f, i) => {
              const p = byId.get(f.perfumeId);
              return (
                <li
                  key={i}
                  className={`flex items-center justify-between py-3 ${
                    i === recent.length - 1 ? "" : "border-b border-line"
                  }`}
                >
                  <div className="min-w-0">
                    <span className="serif text-[0.95rem] font-semibold text-ink">
                      {p ? p.nameZh || p.name : "已移出的香水"}
                    </span>
                    <span className="disp ml-2 text-[0.7rem] tracking-wide text-ink-faint">
                      {OCCASION_LABEL[f.context.occasion] ?? f.context.occasion} ·{" "}
                      {Math.round(f.context.tempC)}°
                    </span>
                  </div>
                  <span className="serif shrink-0 text-[0.82rem] font-semibold text-accent">
                    {RATING_ZH[f.rating]}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 验证指标（本机自证）：换香率 & 吃灰采纳率的原始计数 */}
      <div className="card px-5 py-4">
        <Eyebrow>你的用香习惯 · 本机统计</Eyebrow>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="text-center">
            <div className="disp text-[1.9rem] font-normal leading-none text-ink">
              {hydrated ? swapCount : "—"}
            </div>
            <div className="mt-1.5 text-[0.72rem] text-ink-faint">采纳「换一瓶」次数</div>
          </div>
          <div className="text-center">
            <div className="disp text-[1.9rem] font-normal leading-none text-ink">
              {hydrated ? dustyAdoptCount : "—"}
            </div>
            <div className="mt-1.5 text-[0.72rem] text-ink-faint">翻出吃灰瓶次数</div>
          </div>
        </div>
        <p className="mt-3 text-[0.72rem] leading-relaxed text-ink-faint">
          这两个数是氛寸用来验证「换香 / 吃灰再启用」是否真发生的证伪指标——若长期为 0，说明推荐没创造增量决策价值。
        </p>
      </div>

      {/* 数据 · 本机存储与备份 */}
      <div className="card px-5 py-4">
        <Eyebrow>数据 · 存在你的浏览器里</Eyebrow>
        <p className="serif mt-2.5 text-[0.84rem] leading-relaxed text-ink-soft">
          你的香柜与全部反馈只存在本机浏览器（暂无账号云同步）。换设备或清缓存会清空，建议偶尔导出备份。
        </p>
        <div className="mt-3 flex gap-2.5">
          <button onClick={doExport} className="btn-ghost flex-1 py-2.5 text-[0.82rem]">
            导出香柜（JSON）
          </button>
          <label className="btn-ghost flex-1 cursor-pointer py-2.5 text-center text-[0.82rem]">
            导入
            <input type="file" accept="application/json,.json" onChange={doImport} className="hidden" />
          </label>
        </div>
      </div>

      {/* 关于 */}
      <div className="card px-5 py-4">
        <Eyebrow>关于氛寸的分寸</Eyebrow>
        <p className="serif mt-2.5 text-[0.86rem] font-medium leading-relaxed text-ink-soft">
          推荐与用法精选约 1500 款高频香水（自约 3.6 万款真实社区投票数据中筛选：扩散、留香、四季、日夜、香调）。
          氛寸刻意不给「留香 6.2 小时」这类伪精确数字——留香、喷量、社交距离一律用区间与档位，
          因为无法验证的精确，会摧毁信任。
        </p>
      </div>
    </div>
  );
}
