"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "今日", en: "Today" },
  { href: "/library", label: "香柜", en: "Shelf" },
  { href: "/profile", label: "我的", en: "Me" },
];

function Icon({ name, active }: { name: string; active: boolean }) {
  const s = active ? "var(--color-ink)" : "var(--color-ink-faint)";
  if (name === "/")
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="4.2" stroke={s} strokeWidth="1.5" />
        <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5" stroke={s} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  if (name === "/library")
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M10 3h4v2.5l1.4 1.2c.4.3.6.8.6 1.3V19a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V8c0-.5.2-1 .6-1.3L10 5.5V3Z" stroke={s} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 12h8" stroke={s} strokeWidth="1.5" />
      </svg>
    );
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.4" stroke={s} strokeWidth="1.5" />
      <path d="M5.5 20c.6-3.4 3.2-5.2 6.5-5.2s5.9 1.8 6.5 5.2" stroke={s} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* 顶栏 */}
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link href="/" className="group flex items-baseline gap-2.5">
            <span className="text-xl font-medium tracking-[0.14em] text-ink">氛寸</span>
            <span className="font-display text-[0.62rem] uppercase tracking-[0.34em] text-ink-faint transition-colors group-hover:text-brand">
              Fēn&nbsp;Cùn
            </span>
          </Link>
          <nav className="hidden items-center gap-8 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="group flex flex-col items-center"
              >
                <span
                  className={`text-sm transition-colors ${
                    isActive(n.href) ? "text-ink" : "text-ink-faint hover:text-ink-soft"
                  }`}
                >
                  {n.label}
                </span>
                <span
                  className={`mt-1 h-px w-full origin-center scale-x-0 bg-brand transition-transform duration-300 ${
                    isActive(n.href) ? "scale-x-100" : "group-hover:scale-x-50"
                  }`}
                />
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* 内容 */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-28 pt-6 md:pb-16">
        {children}
      </main>

      {/* 移动端底部 Tab */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur-md md:hidden">
        <div className="mx-auto flex max-w-3xl items-stretch justify-around px-2">
          {NAV.map((n) => {
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className="flex flex-1 flex-col items-center gap-1 py-2.5"
              >
                <Icon name={n.href} active={active} />
                <span
                  className={`text-[0.68rem] tracking-wide ${
                    active ? "text-ink" : "text-ink-faint"
                  }`}
                >
                  {n.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
