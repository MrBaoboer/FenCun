"use client";
import { SILLAGE_WORD, durationShort, nameParts } from "@/lib/format";
import type { Perfume } from "@/lib/types";

export function ShelfCard({
  p,
  dusty,
  onRemove,
  onOpen,
}: {
  p: Perfume;
  dusty?: boolean;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const np = nameParts(p);
  return (
    // 容器不再扮演 button（role="button" 内嵌真 <button> 是 a11y 反模式）：
    // 香名是真按钮，借 ::after 铺满整卡做点击区；删除钮以 z-10 浮在其上，两者互不嵌套
    <div className="card relative flex flex-col p-4 transition-shadow hover:border-line-strong">
      {dusty && (
        <span className="eyebrow absolute right-3 top-3.5 !text-[0.68rem] !text-warn">很久没用</span>
      )}
      <button
        type="button"
        onClick={onOpen}
        // 只有真的挂了角标才给它让位。原来无条件 pr-14（56px）：375px 下卡内宽仅 125px，
        // 香名只剩 69px —— 连四个字的「烟草香草」都要被省略号截掉，而多数卡根本没有角标。
        className={`w-full cursor-pointer text-left after:absolute after:inset-0 after:content-[''] ${
          dusty ? "pr-14" : ""
        }`}
      >
        <span className={`block truncate text-[1.08rem] text-ink ${np.primaryIsZh ? "serif font-bold" : "disp font-semibold"}`}>
          {np.primary}
        </span>
      </button>
      <div className="mt-1 truncate text-[0.72rem] text-ink-faint">
        {np.secondary ? <span className="en-italic">{np.secondary}</span> : null}
        {np.secondary ? " · " : ""}
        {p.brandZh}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-line pt-3 text-[0.68rem] text-ink-faint">
        <span className="serif shrink-0 text-ink-soft">{p.styleTags[0]}</span>
        <span className="disp ml-auto min-w-0 truncate tracking-wide">
          {SILLAGE_WORD[p.sillageTier]} · {durationShort(p.longevity)}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="relative z-10 -m-2 -mr-3 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center text-ink-faint opacity-50 transition-all hover:text-warn hover:opacity-100 focus:opacity-100"
          aria-label="移出香柜"
          title="移出香柜"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M6 7h12M9 7V5h6v2M8 7l1 12h6l1-12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
