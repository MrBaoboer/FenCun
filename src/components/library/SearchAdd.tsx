"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useStore } from "@/lib/store";
import { buildSearch, loadExtSearch, fetchExtPerfume, selectExtHits, type ExtIndexEntry } from "@/lib/perfumes";
import { nameParts } from "@/lib/format";
import { ManualAdd } from "@/components/library/ManualAdd";
import type { Perfume } from "@/lib/types";

// 三级搜索兜底：主目录（Top1500 全中文）→ 扩展集（3.6 万款，英文名/品牌/国货中文）→ 手动记一瓶。
// 柜是推荐引擎的唯一输入——搜不到 = 进不了柜 = 整条产品路径对那瓶香失效，所以这里必须有底。
export function SearchAdd() {
  const { catalog } = useApp();
  const addPerfume = useStore((s) => s.addPerfume);
  const addExtPerfume = useStore((s) => s.addExtPerfume);
  const userPerfumes = useStore((s) => s.userPerfumes);
  const inLib = useMemo(() => new Set(userPerfumes.map((u) => u.perfumeId)), [userPerfumes]);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Perfume[]>([]);
  const [extHits, setExtHits] = useState<ExtIndexEntry[]>([]);
  const [extBusyId, setExtBusyId] = useState<number | null>(null);
  const [extError, setExtError] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const qRef = useRef("");

  const ms = useMemo(() => (catalog ? buildSearch(catalog) : null), [catalog]);
  const byId = useMemo(() => new Map((catalog ?? []).map((p) => [p.id, p])), [catalog]);

  useEffect(() => {
    qRef.current = q;
    setManualOpen(false);
    setExtError(false);
    if (!ms || !q.trim()) {
      setResults([]);
      setExtHits([]);
      return;
    }
    const hits = ms.search(q.trim()).slice(0, 8);
    const main = hits.map((h) => byId.get(h.id as number)).filter(Boolean) as Perfume[];
    setResults(main);
    // 扩展集搜索无条件跑（索引懒加载一次，此后走缓存）——不能按"主目录命中不足"触发：
    // 主目录 OR+fuzzy 的单字垃圾命中会凑数，「观夏」曾因此彻底搜不到。取舍见 selectExtHits。
    const query = q.trim();
    loadExtSearch().then((ext) => {
      if (!ext || qRef.current !== query) return; // 过期查询丢弃
      const mainIds = new Set(main.map((p) => p.id));
      const all = ext.search(query).filter((h) => !mainIds.has(h.i as number)) as unknown as ExtIndexEntry[];
      setExtHits(selectExtHits(all, query, main.length));
    });
  }, [q, ms, byId]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function addFromExt(entry: ExtIndexEntry) {
    setExtBusyId(entry.i);
    setExtError(false);
    const rec = await fetchExtPerfume(entry.i);
    if (rec) addExtPerfume(rec);
    else setExtError(true);
    setExtBusyId(null);
  }

  const open = focused && q.trim().length > 0;

  return (
    <div ref={boxRef} className="relative">
      <div className="card flex items-center gap-2 px-3.5 py-3 focus-within:border-accent">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0">
          <circle cx="11" cy="11" r="6.5" stroke="var(--color-ink-faint)" strokeWidth="1.6" />
          <path d="M20 20l-4-4" stroke="var(--color-ink-faint)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="搜香名 / 品牌 / 香调，点一下就入柜"
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink-faint"
        />
        {q && (
          <button onClick={() => setQ("")} className="text-ink-faint" aria-label="清空">
            ×
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-20 mt-2 w-full animate-fade-in overflow-hidden rounded-lg border border-line bg-surface shadow-float">
          {manualOpen ? (
            <ManualAdd initialName={q.trim()} onDone={() => { setManualOpen(false); setQ(""); }} />
          ) : results.length === 0 && extHits.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-5 text-center">
              <p className="text-sm text-ink-faint">
                没搜到。试试英文名或品牌名——有些香水的中文昵称和官方名差得很远。
              </p>
              <button
                onClick={() => setManualOpen(true)}
                className="chip serif px-4 py-2 text-[0.85rem] hover:text-ink"
              >
                手动记一瓶 →
              </button>
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {results.map((p) => {
                const added = inLib.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      disabled={added}
                      onClick={() => addPerfume(p.id)}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-sunken disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <div className="min-w-0">
                        {(() => {
                          const np = nameParts(p);
                          return (
                            <>
                              <div className={`truncate text-[1rem] text-ink ${np.primaryIsZh ? "serif font-semibold" : "disp"}`}>
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
                      <span
                        className={`ml-3 shrink-0 rounded-pill px-2.5 py-1 text-[0.72rem] ${
                          added ? "text-ink-faint" : "bg-ink text-paper"
                        }`}
                      >
                        {added ? "已在柜" : "+ 入柜"}
                      </span>
                    </button>
                  </li>
                );
              })}

              {extHits.length > 0 && (
                <>
                  <li className="px-4 pb-1 pt-2.5 text-[0.68rem] uppercase tracking-wide text-ink-faint">
                    更多结果 · 来自完整目录
                  </li>
                  {extHits.map((e) => {
                    const added = inLib.has(e.i);
                    const busy = extBusyId === e.i;
                    return (
                      <li key={e.i}>
                        <button
                          disabled={added || busy}
                          onClick={() => addFromExt(e)}
                          className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-sunken disabled:cursor-default disabled:hover:bg-transparent"
                        >
                          <div className="min-w-0">
                            <div className="disp truncate text-[1rem] text-ink">{e.n}</div>
                            <div className="mt-0.5 truncate text-[0.74rem] text-ink-faint">
                              {e.z || e.b}
                            </div>
                          </div>
                          <span
                            className={`ml-3 shrink-0 rounded-pill px-2.5 py-1 text-[0.72rem] ${
                              added ? "text-ink-faint" : "bg-ink text-paper"
                            }`}
                          >
                            {added ? "已在柜" : busy ? "取数据…" : "+ 入柜"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </>
              )}

              <li className="border-t border-line">
                <button
                  onClick={() => setManualOpen(true)}
                  className="w-full px-4 py-2.5 text-left text-[0.8rem] text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
                >
                  都不是它？手动记一瓶 →
                </button>
              </li>
              {extError && (
                <li className="px-4 py-2 text-[0.76rem] text-warn">
                  数据没取到，稍后再试，或先手动记一瓶。
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
