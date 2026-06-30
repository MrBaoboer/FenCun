"use client";
import Link from "next/link";

export function EmptyShelf() {
  return (
    <div className="card animate-fade-up flex flex-col items-center gap-5 px-6 py-12 text-center">
      <svg width="46" height="56" viewBox="0 0 46 56" fill="none">
        <path
          d="M18 4h10v7l3.5 3c1.6 1.4 2.5 3.4 2.5 5.5V47a5 5 0 0 1-5 5H17a5 5 0 0 1-5-5V19.5c0-2.1.9-4.1 2.5-5.5L18 11V4Z"
          stroke="var(--color-brand-soft)"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M14 28h18" stroke="var(--color-line-strong)" strokeWidth="1.4" />
        <rect x="19" y="0.5" width="8" height="4" rx="1" stroke="var(--color-brand-soft)" strokeWidth="1.4" />
      </svg>
      <div>
        <h3 className="font-display text-xl text-ink">你的香柜还是空的</h3>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">
          先把你拥有的香水放进来。氛寸会在每一个此刻，
          从中告诉你今天该喷哪一瓶、怎么喷得恰到好处。
        </p>
      </div>
      <Link
        href="/library"
        className="rounded-lg bg-ink px-5 py-2.5 text-sm text-paper transition-opacity hover:opacity-90"
      >
        搜名字，秒添加 →
      </Link>
    </div>
  );
}
