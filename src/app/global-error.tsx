"use client";
// 根级错误边界。app/error.tsx 只包 page 段，接不住根 layout / AppProvider / SiteChrome
// 自己抛出的错误——那时落到的是 Next 内置的英文 500 页，连 lang="zh-CN" 都没有，
// error.tsx 里那句「你的香柜与反馈都存在本机，没有丢」也不会出现。
// 而那句话恰恰是根级崩溃时最该出现的一句。
//
// global-error 必须自带 <html>/<body>：它替换的是整个文档。
// 这里不引 globals.css（根 layout 已经不参与渲染了），改用内联样式。
//
// 「两套主题都照顾到」此前只是注释：底色写死了明韵那一套，暗香用户崩一次就被闪一脸白。
// 补法必须与全站一致——主题由 localStorage 的 fencun-theme 决定，**不跟系统深浅色走**
//（见根 layout 的同一段说明），所以这里复用同一个内联脚本 + 一组 CSS 变量，
// 而不是图省事写 prefers-color-scheme。
import { useEffect } from "react";

const THEME_CSS = `
:root { --paper: #f1eee7; --ink: #1c1a17; }
:root[data-theme="night"] { --paper: #131315; --ink: #ece7dc; }
`;

// 与根 layout 的首帧脚本同源：在渲染前把主题定死，避免先闪一下另一套配色
const THEME_BOOT = `(function(){try{document.documentElement.dataset.theme=localStorage.getItem('fencun-theme')==='night'?'night':'day';}catch(e){}})();`;

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
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--paper)",
          color: "var(--ink)",
          fontFamily: '"Noto Serif SC", "Songti SC", serif',
        }}
      >
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <div style={{ maxWidth: "26rem", padding: "3rem 1.5rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.7rem", letterSpacing: "0.18em", opacity: 0.55, margin: 0 }}>
            小插曲 · Hiccup
          </p>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, lineHeight: 1.45, margin: "0.75rem 0 0" }}>
            出了点问题，这不是你的错
          </h1>
          <p style={{ fontSize: "0.92rem", lineHeight: 1.75, opacity: 0.75, margin: "0.7rem 0 0" }}>
            你的香柜与反馈都存在本机，没有丢。
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.75rem 1.5rem",
              fontSize: "0.9rem",
              fontFamily: "inherit",
              color: "var(--paper)",
              background: "var(--ink)",
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
