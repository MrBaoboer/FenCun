"use client";
import { SILLAGE_WORD, nameParts } from "@/lib/format";
import type { Perfume } from "@/lib/types";

export function ChangeBottleSheet({
  open,
  onClose,
  perfumes,
  currentId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  perfumes: Perfume[];
  currentId: number | null;
  onSelect: (id: number) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div className="absolute inset-0 animate-fade-in bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 flex max-h-[72vh] w-full max-w-md animate-fade-up flex-col overflow-hidden rounded-t-card border border-line bg-surface shadow-float md:rounded-card">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <div className="eyebrow">换一瓶 · Your Shelf</div>
            <p className="mt-0.5 text-sm text-ink-soft">从你的香柜里选，用法会跟着重算</p>
          </div>
          <button onClick={onClose} className="chip px-3 py-1 text-xs">
            关闭
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {perfumes.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onSelect(p.id);
                onClose();
              }}
              data-active={p.id === currentId}
              className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left transition-colors hover:bg-sunken data-[active=true]:bg-brand-wash"
            >
              <div className="min-w-0">
                {(() => {
                  const np = nameParts(p);
                  return (
                    <>
                      <div className={`truncate text-[1.02rem] text-ink ${np.primaryIsZh ? "" : "font-display"}`}>
                        {np.primary}
                      </div>
                      <div className="mt-0.5 truncate text-[0.74rem] text-ink-faint">
                        {np.secondary ? `${np.secondary} · ` : ""}
                        {p.brandZh} · {p.styleTags[0]}
                      </div>
                    </>
                  );
                })()}
              </div>
              <span className="ml-3 shrink-0 text-[0.72rem] text-ink-soft">
                {SILLAGE_WORD[p.sillageTier]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
