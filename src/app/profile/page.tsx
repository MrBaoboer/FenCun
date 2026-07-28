"use client";
import { useMemo, useRef, useState } from "react";
import { useStore, type ImportPreview } from "@/lib/store";
import { useLibraryPerfumes } from "@/lib/hooks";
import { useApp } from "@/components/AppProvider";
import { aggregateBias } from "@/lib/recommend";
import { Eyebrow } from "@/components/ui";
import { OCCASION_LABEL } from "@/lib/format";
import { buildDemoState } from "@/lib/demo";

export default function ProfilePage() {
  const lib = useLibraryPerfumes();
  const feedbacks = useStore((s) => s.feedbacks);
  const hydrated = useStore((s) => s.hydrated);
  const exportData = useStore((s) => s.exportData);
  const importData = useStore((s) => s.importData);
  const previewImport = useStore((s) => s.previewImport);
  const userPerfumes = useStore((s) => s.userPerfumes);
  const wearLog = useStore((s) => s.wearLog);
  const [importMsg, setImportMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // 待确认的导入：文件已读、已校验，但还没落盘——覆盖必须由用户在看到差额后亲手点下
  const [pending, setPending] = useState<{ raw: string; preview: ImportPreview } | null>(null);
  // 回到初次打开那副样子的入口（示例态不在界面上自报身份——那对初次到访的人是打扰）
  const { catalog, resolveByCity } = useApp();
  const resetToDemo = useStore((s) => s.resetToDemo);
  const [demoConfirm, setDemoConfirm] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // 导入成功后城市可能被换掉了（备份里带着它），得跟着重新取一次天气——
  // 否则情境栏会停在上一座城市的读数上，屏上的城市和天气对不上，推荐也还是按旧天气算的。
  // 隔壁「重置到初始状态」早就这么做了（那里 `void resolveByCity(d.city)`），
  // 导入这条路漏了：同一个后果，只有一处收拾。
  function applyImport(raw: string): boolean {
    const before = useStore.getState().city;
    const ok = importData(raw);
    if (ok) {
      const after = useStore.getState().city;
      if (after && after !== before) void resolveByCity(after);
    }
    return ok;
  }

  // 导出是这个纯本机、无账号无后端的产品里**唯一**的数据保全手段，界面上还明写着
  // 「建议偶尔导出备份」。所以两件事都得做：
  //   ① 用标准写法——锚点挂进文档再点，撤销 URL 推迟到下一帧。脱离文档的锚点与
  //      同步 revoke 在非 Chromium 内核上是有名的不可靠组合（本机无法跨浏览器验证，
  //      但这么写无论如何都只有好处、零风险）；
  //   ② 给一次成功回执。此前整个流程没有任何反馈，点了没反应的用户会以为已经备份好了，
  //      直到换设备才发现什么都没有——复用本页已有的 importMsg 播报位即可。
  function doExport() {
    const name = `氛寸香柜-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([exportData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    requestAnimationFrame(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
    setImportMsg({ kind: "ok", text: `已生成 ${name}——请确认它真的下载到了本机。` });
  }
  function doImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result);
      const preview = previewImport(raw);
      if (!preview) {
        setPending(null);
        setImportMsg({ kind: "error", text: "这份文件氛寸认不出来——请选择之前从氛寸导出的 JSON 备份。" });
        return;
      }
      setImportMsg(null);
      // 空柜直接导入（没有任何东西会被覆盖）；柜里有东西则必须先看清差额再确认
      if (userPerfumes.length === 0 && wearLog.length === 0) {
        const ok = applyImport(raw);
        setImportMsg(
          ok
            ? { kind: "ok", text: "导入完成，香柜、反馈与香历都回来了。" }
            : { kind: "error", text: "这份文件氛寸认不出来——请选择之前从氛寸导出的 JSON 备份。" }
        );
        return;
      }
      setPending({ raw, preview });
    };
    reader.onerror = () =>
      setImportMsg({ kind: "error", text: "文件没读出来，可能已损坏——换个文件再试试。" });
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
    // 只有一瓶时说「它们」，画像的第一句就在告诉用户这段话不是为他写的
    const it = (n: number) => (n > 1 ? "它们" : "它");
    if (strongN > 0)
      lines.push(`有 ${strongN} 瓶你反馈过偏冲——再推荐${it(strongN)}时，喷量与扩散都会各自收一点。`);
    if (weakN > 0)
      lines.push(`有 ${weakN} 瓶你反馈过偏淡——再推荐${it(weakN)}时，会建议略增喷量。`);
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
    scene_mismatch: "不合场合",
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
                    {/* 防御性访问：损坏/旧版数据缺 context 时也不白屏（store 导入已深校验，这里是双保险） */}
                    <span className="disp ml-2 text-[0.7rem] tracking-wide text-ink-faint">
                      {OCCASION_LABEL[f.context?.occasion ?? ""] ?? f.context?.occasion ?? "—"}
                      {typeof f.context?.tempC === "number" ? ` · ${Math.round(f.context.tempC)}℃` : ""}
                    </span>
                  </div>
                  <span className="serif shrink-0 text-[0.82rem] font-semibold text-accent">
                    {RATING_ZH[f.rating] ?? "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 数据 · 本机存储与备份 */}
      <div className="card px-5 py-4">
        <Eyebrow>数据</Eyebrow>
        <p className="serif mt-2.5 text-[0.84rem] leading-relaxed text-ink-soft">
          你的香柜与全部反馈只存在本机浏览器（暂无账号云同步）。换设备或清缓存会清空，建议偶尔导出备份。
        </p>
        <div className="mt-3 flex gap-2.5">
          <button onClick={doExport} className="btn-ghost flex-1 py-2.5 text-[0.82rem]">
            导出香柜（JSON）
          </button>
          {/* 曾是 <label> 包一个 display:none 的 file input —— label 本身不在 tab 序列，
              于是「导入」这个控件对键盘用户**完全不存在**。改成真按钮转发点击，
              input 退居幕后只当文件选择器的载体。 */}
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="btn-ghost flex-1 py-2.5 text-[0.82rem]"
          >
            导入
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={doImport}
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
          />
        </div>

        {/* 回到初次打开那副样子的入口。按钮自己说清了要干什么，代价放在二次确认里说，
            不在动作之前先铺一段说明——那属于"解释产品在演示自己"，与撤掉的那几处同一类。 */}
        <div className="mt-1">
          {demoConfirm ? (
            <div className="mt-3 rounded-md border border-warn/40 bg-warn-wash px-3.5 py-3">
              <p className="serif text-[0.84rem] leading-relaxed text-ink">
                这会清掉本机的<span className="text-warn">香柜、反馈与香历</span>，换回六瓶示例。
              </p>
              <p className="serif mt-1.5 text-[0.78rem] leading-relaxed text-ink-faint">
                这一步不可撤销。要保住现在这份，先「导出香柜」再回来。
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={() => {
                    const d = buildDemoState(catalog, Date.now());
                    setDemoConfirm(false);
                    if (!d) {
                      setImportMsg({ kind: "error", text: "香水目录还没加载好，稍等一下再试。" });
                      return;
                    }
                    resetToDemo(d);
                    // 城市也被复位成北京了，得跟着重新取一次天气——
                    // 否则情境栏会停在上一座城市的读数上，屏上的城市和天气对不上
                    void resolveByCity(d.city);
                    setImportMsg({ kind: "ok", text: "已回到初次打开的样子。" });
                  }}
                  className="btn-primary flex-1 py-2 text-[0.8rem]"
                >
                  确认清空
                </button>
                <button onClick={() => setDemoConfirm(false)} className="btn-ghost flex-1 py-2 text-[0.8rem]">
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setDemoConfirm(true)} className="btn-ghost mt-3 w-full py-2.5 text-[0.82rem]">
              重置到初始状态
            </button>
          )}
        </div>
        {pending && (
          <div className="mt-3 rounded-md border border-warn/40 bg-warn-wash px-3.5 py-3">
            <p className="serif text-[0.84rem] font-semibold leading-relaxed text-ink">
              导入会<span className="text-warn">整包替换</span>现在的数据，不是合并。
            </p>
            <p className="serif mt-1.5 text-[0.82rem] leading-relaxed text-ink-soft">
              现在：{userPerfumes.length} 瓶在柜 · {feedbacks.length} 条反馈 · {wearLog.length} 天香历
              <br />
              导入后：{pending.preview.perfumes} 瓶在柜 · {pending.preview.feedbacks} 条反馈 ·{" "}
              {pending.preview.wearDays} 天香历
            </p>
            <p className="serif mt-1.5 text-[0.78rem] leading-relaxed text-ink-faint">
              这一步不可撤销。要保住现在这份，先「导出香柜」再回来导入。
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                onClick={() => {
                  const ok = applyImport(pending.raw);
                  setPending(null);
                  setImportMsg(
                    ok
                      ? { kind: "ok", text: "导入完成，香柜、反馈与香历都回来了。" }
                      : { kind: "error", text: "导入没能完成，现在的数据没有被改动。" }
                  );
                }}
                className="btn-primary flex-1 py-2 text-[0.8rem]"
              >
                确认替换
              </button>
              <button onClick={() => setPending(null)} className="btn-ghost flex-1 py-2 text-[0.8rem]">
                取消
              </button>
            </div>
          </div>
        )}
        {importMsg && (
          <p
            role="status"
            className={`serif mt-2.5 text-[0.8rem] leading-relaxed ${
              importMsg.kind === "ok" ? "text-ink-soft" : "text-warn"
            }`}
          >
            {importMsg.text}
          </p>
        )}
      </div>
    </div>
  );
}
