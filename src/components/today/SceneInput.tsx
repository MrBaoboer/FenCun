"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";

function Sparkle() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="shrink-0 text-accent">
      <path d="M12 3l1.5 5.2L19 10l-5.5 1.8L12 17l-1.5-5.2L5 10l5.5-1.8L12 3Z" fill="currentColor" />
    </svg>
  );
}

export function SceneInput() {
  const scene = useStore((s) => s.scene);
  const setScene = useStore((s) => s.setScene);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      const r = await fetch("/api/parse-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t }),
      });
      const d = await r.json();
      if (d?.occasion && d?.label) {
        setScene({
          occasion: d.occasion,
          formality: d.formality,
          intimacy: d.intimacy,
          avoid: d.avoid,
          label: d.label,
          rawText: t,
        });
        setText("");
      }
    } catch {}
    setBusy(false);
  }

  if (scene) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md bg-brand-wash px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkle />
          <span className="serif truncate text-[0.86rem] text-ink">
            <span className="text-ink-faint">氛寸读到 · </span>
            <span className="font-semibold">{scene.label}</span>
          </span>
        </div>
        <button
          onClick={() => setScene(null)}
          className="shrink-0 text-[1.1rem] leading-none text-ink-faint hover:text-ink"
          aria-label="清除场景"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2 rounded-md border border-line-strong px-3 py-2 focus-within:border-accent"
    >
      <Sparkle />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="或用一句话说说今天的场合，如「第一次见投资人」"
        className="serif w-full bg-transparent text-[0.86rem] text-ink outline-none placeholder:text-ink-faint"
      />
      <button
        type="submit"
        disabled={busy || !text.trim()}
        className="shrink-0 text-accent transition-opacity disabled:text-ink-faint disabled:opacity-50"
        aria-label="解析场景"
      >
        {busy ? (
          <span className="text-[0.8rem]">…</span>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </form>
  );
}
