"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV = [
  { href: "/", label: "今日" },
  { href: "/library", label: "香柜" },
  { href: "/profile", label: "我的" },
];

export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="flex min-h-dvh flex-col">
      {/* 报头 —— 顶部留足呼吸感（含刘海安全区） */}
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-baseline justify-between px-6 pb-4 pt-[calc(env(safe-area-inset-top,0px)+1.5rem)]">
          <Link href="/" className="group flex items-baseline gap-2.5">
            <span className="serif text-[1.4rem] font-bold tracking-[0.12em] text-ink">氛寸</span>
            <span className="disp text-[0.6rem] uppercase tracking-[0.34em] text-accent">Fēn&nbsp;Cùn</span>
          </Link>
          <div className="flex items-center gap-7">
            <nav className="hidden items-baseline gap-9 md:flex">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="group flex flex-col items-center">
                  <span
                    className={`serif text-[0.95rem] transition-colors ${
                      isActive(n.href) ? "text-ink" : "text-ink-faint hover:text-ink-soft"
                    }`}
                  >
                    {n.label}
                  </span>
                  <span
                    className={`mt-1 h-px w-full origin-center bg-accent transition-transform duration-300 ${
                      isActive(n.href) ? "scale-x-100" : "scale-x-0 group-hover:scale-x-50"
                    }`}
                  />
                </Link>
              ))}
            </nav>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 pb-28 pt-7 md:pb-16">{children}</main>

      {/* 移动端 —— 悬浮胶囊分段导航 */}
      <nav className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+16px)] z-30 flex justify-center px-6 md:hidden">
        <div className="flex items-center gap-1 rounded-pill border border-line bg-surface/95 p-1.5 shadow-float backdrop-blur-md">
          {NAV.map((n) => {
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`serif rounded-pill px-6 py-2 text-[0.92rem] transition-colors ${
                  active ? "bg-sunken font-semibold text-ink" : "text-ink-faint"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
