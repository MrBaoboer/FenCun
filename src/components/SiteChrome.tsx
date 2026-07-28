"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SiteNotice } from "@/components/SiteNotice";

const NAV = [
  { href: "/", label: "今日" },
  { href: "/library", label: "香柜" },
  { href: "/journal", label: "香历" },
  { href: "/profile", label: "我的" },
];

export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="flex min-h-dvh flex-col">
      {/* 报头 —— 顶部留足呼吸感（含刘海安全区） */}
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 pb-4 pt-[calc(env(safe-area-inset-top,0px)+1.5rem)]">
          <Link href="/" className="group flex items-baseline gap-2.5">
            <span className="serif text-[1.4rem] font-bold tracking-[0.12em] text-ink">氛寸</span>
            <span className="disp text-[0.6rem] uppercase tracking-[0.34em] text-accent">Fēn&nbsp;Cùn</span>
          </Link>
          <div className="flex items-center gap-7">
            <nav className="hidden items-center gap-9 md:flex">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={isActive(n.href) ? "page" : undefined}
                  className="group relative flex items-center"
                >
                  <span
                    className={`serif text-[0.95rem] transition-colors ${
                      isActive(n.href) ? "text-ink" : "text-ink-faint hover:text-ink-soft"
                    }`}
                  >
                    {n.label}
                  </span>
                  <span
                    className={`absolute inset-x-0 -bottom-1.5 h-px origin-center bg-accent transition-transform duration-300 ${
                      isActive(n.href) ? "scale-x-100" : "scale-x-0 group-hover:scale-x-50"
                    }`}
                  />
                </Link>
              ))}
            </nav>
            <ThemeToggle />
          </div>
        </div>
        <SiteNotice />
      </header>

      {/* tabIndex={-1}：弹层关闭时若触发元素已被卸载，焦点退到这里而不是掉回 <body>（见 useDialogA11y） */}
      <main tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-6 pb-28 pt-7 outline-none md:pb-16">
        {children}
      </main>

      {/* 移动端 —— 悬浮胶囊分段导航。
          ⚠️ 外层 nav 用 inset-x-0 铺满整行只是为了把胶囊居中，可见的只有中间那一段；
          但它照样是一条 52px 高的全宽命中区，会把底下的东西整条盖住。实测后果不是
          「点了没反应」而是更糟的一种：点搜索结果里靠底的那一条「+ 入柜」，命中的是
          导航链接，用户会被直接送去另一个页面。而搜索结果列表的底边永远落在这条带子里，
          钉在末尾的「都不是它？手动记一瓶」那条兜底出口因此在满列表下始终点不到。
          所以透明区一律放行，只让胶囊本身接收指针事件——视觉零变化。 */}
      <nav className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+16px)] z-30 flex justify-center px-6 md:hidden">
        <div className="pointer-events-auto flex items-center gap-1 rounded-pill border border-line bg-surface/95 p-1.5 shadow-float backdrop-blur-md">
          {NAV.map((n) => {
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`serif rounded-pill px-4 py-2 text-[0.92rem] transition-colors ${
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
