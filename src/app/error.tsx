"use client";
// App Router 错误边界：页面渲染出错时兜底——绝不白屏，绝不让用户以为香柜数据丢了
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 仅供开发者排查；不弹窗、不打扰用户
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card w-full max-w-md px-6 py-12 text-center">
        <div className="eyebrow eyebrow-mute">小插曲 · Hiccup</div>
        <h1 className="serif mt-3 text-[1.4rem] font-bold leading-snug text-ink">
          出了点问题，这不是你的错
        </h1>
        <p className="serif mx-auto mt-2.5 max-w-xs text-[0.9rem] leading-relaxed text-ink-soft">
          你的香柜与反馈都存在本机，没有丢。
        </p>
        <button onClick={reset} className="btn-primary mt-6 px-6 py-3 text-[0.9rem]">
          再试一次
        </button>
      </div>
    </div>
  );
}
