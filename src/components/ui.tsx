// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

"use client";
import { ReactNode, RefObject, useEffect, useRef } from "react";

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}

// 弹层可访问性（手工补齐语义版——现有弹层动画/定位重构成原生 <dialog> 风险大）：
// 打开时焦点移入面板、Esc 关闭、锁定 body 滚动、关闭后焦点还给触发元素。
// 用法：面板根节点挂 ref + tabIndex={-1} + role="dialog" + aria-modal="true"。
export function useDialogA11y(open: boolean, onClose: () => void): RefObject<HTMLDivElement | null> {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    // 焦点陷阱：声明了 aria-modal="true" 就等于向辅助技术承诺"面板之外的东西现在不存在"。
    // 没有陷阱时 Tab 会走进背景里那些视觉上被遮住、语义上仍可聚焦的控件（实测 27 个），
    // 键盘用户看不见焦点在哪，也走不回来——这比不声明 aria-modal 更糟。
    const focusables = () => {
      const panel = panelRef.current;
      if (!panel) return [] as HTMLElement[];
      const sel =
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
      // offsetParent 为 null = 被 display:none 折叠；position:fixed 例外，故一并放行
      return [...panel.querySelectorAll<HTMLElement>(sel)].filter(
        (el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed"
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // 焦点还给触发元素——但「选定后关闭」这条路径上，触发元素往往已经被 React 卸下或换掉了
      // （换一瓶 → 推荐卡整块重渲染）。对一个脱离了文档的节点调 focus() 是空操作，
      // 焦点于是掉回 <body>，键盘用户被扔回页面最顶端。所以先确认它还在文档里，
      // 不在就退到主内容容器——那里离用户刚才的位置最近。
      requestAnimationFrame(() => {
        if (prevFocus && document.contains(prevFocus)) prevFocus.focus();
        else document.querySelector<HTMLElement>("main")?.focus();
      });
    };
  }, [open]);
  return panelRef;
}

// 证据条：0..1 匹配度 → 一次性生长的细横条
export function EvidenceBar({
  label,
  value,
  hint,
  tone = "brand",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "brand" | "accent" | "warn";
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color =
    tone === "accent" ? "var(--color-accent)" : tone === "warn" ? "var(--color-warn)" : "var(--color-brand)";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[0.82rem] text-ink-soft">{label}</span>
        {hint && <span className="text-[0.74rem] text-ink-faint">{hint}</span>}
      </div>
      <div className="h-[3px] w-full overflow-hidden bg-sunken">
        <div className="bar-grow h-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// 香调条：中文香调 + 0..100 强度
export function AccordBar({ zh, strength }: { zh: string; strength: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="serif w-20 shrink-0 text-right text-[0.82rem] text-ink-soft">{zh}</span>
      <div className="h-[3px] flex-1 overflow-hidden bg-sunken">
        <div className="bar-grow h-full" style={{ width: `${strength}%`, backgroundColor: "var(--color-accent-soft)" }} />
      </div>
    </div>
  );
}

// 规格单元：小眉标 + 宋体值 + 说明
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {/* 曾覆盖成 !text-[0.58rem]（9.28px）——中文在那个尺寸上读不动，去掉覆盖回到 .eyebrow */}
      <span className="eyebrow eyebrow-mute">{label}</span>
      {/* 375px 下三等分列宽约 93px：1.15rem 的「一整个白天」正好装不下而换行，
          再叠 leading-none 就两行贴死。降到 1.08rem 让五字档位词一行放得下，
          并把行高还回去——万一仍换行也不至于糊成一团。 */}
      <span className="serif text-[1.08rem] font-bold leading-[1.2] text-ink">{value}</span>
      {sub && <span className="text-[0.68rem] leading-tight text-ink-faint">{sub}</span>}
    </div>
  );
}
