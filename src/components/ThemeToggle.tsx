"use client";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"day" | "night" | null>(null);

  useEffect(() => {
    const t = (document.documentElement.dataset.theme as "day" | "night") || "day";
    setTheme(t);
  }, []);

  function toggle() {
    const next = theme === "night" ? "day" : "night";
    const el = document.documentElement;
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
      aria-label={theme === "night" ? "切到白天" : "切到夜晚"}
      title={theme === "night" ? "切到白天" : "切到夜晚"}
      className="text-ink-faint transition-colors hover:text-accent"
    >
      {theme === "night" ? (
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
