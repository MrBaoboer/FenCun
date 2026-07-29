"use client";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"day" | "night" | null>(null);

  // 单一事实源是 <html data-theme>（首帧由 layout 内联脚本定，默认明韵）。
  // 这里用 MutationObserver 跟随而不是自持一份状态：外部改写 data-theme 时
  //（截图脚本会直接设，将来若加别的入口同理）图标与 aria-label 不会和实际主题脱节。
  useEffect(() => {
    const read = () =>
      setTheme((document.documentElement.dataset.theme as "day" | "night") || "day");
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  function toggle() {
    const el = document.documentElement;
    // 以 DOM 当前值为准取反（而非组件状态），杜绝"首次点击没反应"
    const next = el.dataset.theme === "night" ? "day" : "night";
    el.classList.add("theme-switching"); // 本次切换禁用过渡，避免城市名等淡入
    el.dataset.theme = next;
    try {
      localStorage.setItem("fencun-theme", next);
    } catch {}
    setTheme(next);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("theme-switching")));
  }

  // 挂载前占位，避免 SSR/客户端不一致
  if (!theme) return <span className="block h-5 w-5" aria-hidden />;

  return (
    <button
      onClick={toggle}
      aria-label={theme === "night" ? "切到明韵" : "切到暗香"}
      title={theme === "night" ? "切到明韵" : "切到暗香"}
      className="icon-btn"
    >
      {theme === "night" ? (
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
