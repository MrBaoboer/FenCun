"use client";
import Link from "next/link";

export function EmptyShelf() {
  return (
    <div className="card animate-fade-up flex flex-col items-center gap-6 px-6 py-14 text-center">
      <svg width="44" height="54" viewBox="0 0 46 56" fill="none">
        <path
          d="M18 4h10v7l3.5 3c1.6 1.4 2.5 3.4 2.5 5.5V47a5 5 0 0 1-5 5H17a5 5 0 0 1-5-5V19.5c0-2.1.9-4.1 2.5-5.5L18 11V4Z"
          stroke="var(--color-accent-soft)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M14 28h18" stroke="var(--color-line-strong)" strokeWidth="1.3" />
        <rect x="19" y="0.5" width="8" height="4" rx="1" stroke="var(--color-accent-soft)" strokeWidth="1.3" />
      </svg>
      <div>
        <h3 className="serif text-[1.4rem] font-bold text-ink">你的香柜还是空的</h3>
        <p className="serif mx-auto mt-2.5 max-w-xs text-[0.92rem] leading-relaxed text-ink-soft">
          先把你拥有的香水放进来。氛寸会在每一个此刻，
          从中告诉你今天该喷哪一瓶、怎么喷得恰到好处。
        </p>
      </div>
      <Link href="/library" className="btn-primary px-6 py-3 text-[0.9rem]">
        搜名字，秒添加 →
      </Link>
    </div>
  );
}
