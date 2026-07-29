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
            {/* 报头这一处**不带声调**，原因实测过：
                  · Fraunces 以 subsets:["latin"] 引入，只发 Latin-1 那一片；
                  · uppercase 后「ē」是预组合的「Ē」(U+0112)，属 Latin Extended-A，
                    不在那一片里——`document.fonts.check(Fraunces,"Ē")` 为 false，
                    而且把它写进 DOM 也**不会**触发任何新的 woff2 请求：那片压根不发。
                  于是「Ē」永久落回 Georgia，与旁边真·Fraunces 的字母不同源。
                  「Ù」(U+00D9) 在 Latin-1 里、有字形，所以出问题的只有 fen 上面那一横。
                裸字母全部落在 Latin-1，任何时刻都同源。
                （分享卡片与 metadata 里保留带声调的写法：前者由 og.mjs 单独排版、
                字号大且不经 uppercase，后者根本不由我们渲染。） */}
            <span className="disp text-[0.6rem] uppercase tracking-[0.34em] text-accent">Fen&nbsp;Cun</span>
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
            {/* 源码入口。只放图标不放文字：报头右侧的空间留给导航，猫头是通行符号 */}
            <a
              href="https://github.com/MrBaoboer/FenCun"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="在 GitHub 上查看源码"
              title="在 GitHub 上查看源码"
              className="icon-btn"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </a>
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
                className={`serif rounded-pill px-4 py-2 text-[0.9rem] transition-colors ${
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
