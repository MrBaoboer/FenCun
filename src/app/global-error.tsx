"use client";
// 根级错误边界。app/error.tsx 只包 page 段，接不住根 layout / AppProvider / SiteChrome
// 自己抛出的错误——那时落到的是 Next 内置的英文 500 页，连 lang="zh-CN" 都没有，
// error.tsx 里那句「你的香柜与全部反馈都存在本机浏览器里，没有丢」也不会出现。
// 而那句话恰恰是根级崩溃时最该出现的一句。
//
// global-error 必须自带 <html>/<body>：它替换的是整个文档。
// 这里不引 globals.css（根 layout 已经不参与渲染了），改用内联样式，
// 同时把两套主题的底色都照顾到，免得深色系统下穿帮。
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f1eee7",
          color: "#1c1a17",
          fontFamily: '"Noto Serif SC", "Songti SC", serif',
        }}
      >
        <div style={{ maxWidth: "26rem", padding: "3rem 1.5rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.7rem", letterSpacing: "0.18em", opacity: 0.55, margin: 0 }}>
            小插曲 · Hiccup
          </p>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, lineHeight: 1.45, margin: "0.75rem 0 0" }}>
            出了点问题，这不是你的错
          </h1>
          <p style={{ fontSize: "0.92rem", lineHeight: 1.75, opacity: 0.75, margin: "0.7rem 0 0" }}>
            页面遇到了一个意外错误。你的香柜与全部反馈都存在本机浏览器里，没有丢。
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.75rem 1.5rem",
              fontSize: "0.9rem",
              fontFamily: "inherit",
              color: "#f1eee7",
              background: "#1c1a17",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
            }}
          >
            再试一次
          </button>
        </div>
      </body>
    </html>
  );
}
