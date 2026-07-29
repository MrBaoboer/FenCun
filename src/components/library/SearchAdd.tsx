"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useStore } from "@/lib/store";
import {
  buildSearch,
  loadExtSearch,
  rankSearchHits,
  type RankCandidate,
  type ExtIndexEntry,
} from "@/lib/perfumes";
import { fetchExtPerfume } from "@/lib/catalog";
import { nameParts } from "@/lib/format";
import { ManualAdd } from "@/components/library/ManualAdd";
import type { Perfume } from "@/lib/types";

// 候选合并成一张榜单：主目录（Top1500 全中文）与扩展集（3.6 万款）统一重排，不分区——
// 「更多结果」式区隔会让用户以为上面没有匹配（真实用户反馈）。排序见 rankSearchHits。
// 搜不到的最后防线仍是手动记一瓶。
type MergedItem = { source: "main"; p: Perfume } | { source: "ext"; e: ExtIndexEntry };

export function SearchAdd() {
  const { catalog } = useApp();
  const addPerfume = useStore((s) => s.addPerfume);
  const addExtPerfume = useStore((s) => s.addExtPerfume);
  const userPerfumes = useStore((s) => s.userPerfumes);
  const demo = useStore((s) => s.demo);
  const inLib = useMemo(() => new Set(userPerfumes.map((u) => u.perfumeId)), [userPerfumes]);

  const [q, setQ] = useState("");
  const [items, setItems] = useState<MergedItem[]>([]);
  const [extBusyId, setExtBusyId] = useState<number | null>(null);
  const [extError, setExtError] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const qRef = useRef("");

  // 索引不在渲染阶段建。useMemo 是同步的，catalog 一到位就会在同一帧里跑完 1500 条的
  // addAll（实测 116–185ms，中端手机按 3 倍约 350–550ms），正好压在香柜列表首次绘制那一帧上；
  // 而进香柜页的人多半只是想看看柜里有什么，未必要搜。作者已经为 3.6 万条的扩展索引写好了
  // focus 预热（见下方 onFocus 的 loadExtSearch），这条 1500 条的同步路径恰恰漏在默认路径上。
  // buildSearch 内部有单例缓存（perfumes.ts:searchCache），重复调用零成本。
  // 放 ref 不放 state：建索引不产出任何要渲染的东西，只是把一件慢活挪出首绘那一帧。
  const msRef = useRef<ReturnType<typeof buildSearch> | null>(null);
  const warmSearch = () => {
    if (!msRef.current && catalog) msRef.current = buildSearch(catalog);
    return msRef.current;
  };
  const byId = useMemo(() => new Map((catalog ?? []).map((p) => [p.id, p])), [catalog]);

  useEffect(() => {
    qRef.current = q;
    // ⚠️ **不要**在这里无条件 setManualOpen(false)。
    //
    // 这个 effect 的依赖是 [q, catalog, byId]，于是「手动记一瓶」正开着时，用户在上方
    // 搜索框多打一个字，整张已经填好的表就被卸载：name/brand/勾好的香调/扩散档全没。
    // 目录晚到时更隐蔽——catalog 由 null 变成数组也会跑一次，而「目录还没到位就点开
    // 手动记一瓶」恰恰是首次到访最常见的顺序（见下方 warmSearch 的注释）。
    // 用户在这张表里输入的是全站唯一无法从别处回填的数据：13 个香调 chip 没有任何来源，
    // 而 canSave 要求至少勾一个。
    //
    // 同一个组件的另一处（外部点击 onClick，:100）已经为此专门写了 `if (manualOpen) return`，
    // 只是这一条路漏了。表单只由它自己的「取消 / 入柜」关闭。
    setExtError(false);
    // 兜住"目录到位之前就点了搜索框"这条顺序（首次到访最常见）：那一下 catalog 还是 null，
    // 预热落空，这里补建一次。buildSearch 内部有单例缓存，重复调用零成本。
    const ms = warmSearch();
    if (!ms || !q.trim()) {
      setItems([]);
      return;
    }
    const query = q.trim();
    const mainHits = ms.search(query).slice(0, 12);
    const mainCands: RankCandidate<MergedItem>[] = mainHits
      .map((h) => byId.get(h.id as number))
      .filter(Boolean)
      .map((p) => ({
        item: { source: "main" as const, p: p! },
        nameHay: `${p!.nameZh ?? ""} ${(p!.aliases ?? []).join(" ")} ${p!.name}`,
        fullHay: `${p!.nameZh ?? ""} ${(p!.aliases ?? []).join(" ")} ${p!.name} ${p!.brandZh} ${p!.brand}`,
        people: p!.people,
      }));
    // 先用主目录候选即时出结果（扩展索引首次加载有延迟），扩展候选到位后合并重排
    setItems(rankSearchHits(query, mainCands));
    loadExtSearch().then((ext) => {
      if (!ext || qRef.current !== query) return; // 过期查询丢弃
      const mainIds = new Set(mainCands.map((c) => (c.item as { p: Perfume }).p.id));
      const extCands: RankCandidate<MergedItem>[] = (
        ext.search(query).slice(0, 50) as unknown as ExtIndexEntry[]
      )
        .filter((e) => !mainIds.has(e.i))
        .map((e) => ({
          item: { source: "ext" as const, e },
          nameHay: e.n,
          fullHay: `${e.n} ${e.b} ${e.z ?? ""}`,
          people: e.p,
        }));
      setItems(rankSearchHits(query, [...mainCands, ...extCands]));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, catalog, byId]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      // 手动记一瓶正开着时不许被外部点击收走：表单状态挂在 ManualAdd 里，
      // 一卸载 name/品牌/已勾的香调全没，而香调没有任何回填来源（香名还能从搜索词回填）。
      // canSave 又要求至少勾一个香调，于是用户得把 13 个 chip 重挑一遍。
      // 它只由自己的「取消 / 入柜」关闭。
      if (manualOpen) return;
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [manualOpen]);

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
        {/* 键盘用户此前没有出口：下拉的唯一关闭途径是 document 上的 mousedown，
            按 Esc 无反应，只能 Tab 穿过整张榜单；触屏收起键盘后下拉也仍盖着香柜网格。
            只补 Esc 与结果计数播报，**不上** role="combobox"/listbox——那套语义会让读屏
            宣告「列表框，12 项」并期待方向键与 aria-activedescendant，而这些还不存在，
            等于把一个静默的问题换成一个会撒谎的问题。要上就连方向键一起上。
            aria-expanded 同理：裸 input 的隐式 role 是 textbox，它不支持这个属性
            （eslint 的 jsx-a11y 会直接报），半套 ARIA 比没有更糟。 */}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => {
            setFocused(true);
            // 主目录索引与扩展索引同一时机预热：手指还在移向键盘的那几百毫秒里建好
            warmSearch();
            // 扩展索引（gzip 748KB + 主线程建索引，桌面实测 330–580ms）此前是在**敲下第一个字符**
            // 时才开始下载与建索引的，正好压在用户打字最密集的那两秒里。
            // 「搜名字秒添加」是产品红线，这里把它提前到手指还在移向键盘的那几百毫秒。
            // fire-and-forget：loadExtSearch 内部有单例缓存，重复调用不会重复下载；
            // 失败也不处理——真正的取舍与降级仍由下面那条 q-effect 负责。
            void loadExtSearch();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && open) {
              e.stopPropagation();
              setFocused(false);
            }
          }}
          placeholder="搜香名 / 品牌 / 香调"
          autoComplete="off"
          className="w-full bg-transparent text-sm placeholder:text-ink-faint"
        />
        {q && (
          // 热区：× 本身只有 9.7px 宽，触屏上基本要瞄准才点得到（WCAG 2.5.8 AA 下限 24px）。
          // 用伪元素撑到 44×44，视觉零变化——与仓库里其它图标钮同一写法。
          <button
            onClick={() => setQ("")}
            className="relative text-ink-faint after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
            aria-label="清空"
          >
            ×
          </button>
        )}
      </div>
      {/* 结果条数对读屏用户此前完全静默——「搜名字秒添加」是产品主路径，
          不该只有看得见的人知道有几条可选。 */}
      <p aria-live="polite" className="sr-only">
        {open ? (items.length > 0 ? `${items.length} 条结果` : "没搜到") : ""}
      </p>
      {/* 加第一瓶 = 示例香柜整体退场，连同演示态里写过的手记与反馈一起清空
          （见 store.ts:DEMO_CLEARED 的理由：示例数据不得与真实数据混柜）。
          这个语义是对的，缺的只是告知——它此前只写在「我的 · 数据」那一栏，
          而触发点在这里。把同一句话挪到动作旁边，比事后补一条撤销更省。 */}
      {demo && open && (
        <p className="mt-1.5 px-1 text-[0.74rem] leading-relaxed text-ink-faint">
          加进你自己的第一瓶，示例的六瓶和那段记录会一起退场。
        </p>
      )}

      {open && (
        <div className="absolute z-40 mt-2 w-full animate-fade-in overflow-hidden rounded-lg border border-line bg-surface shadow-float">
          {/* 取数失败的提示钉在下拉顶部，**不能**跟在结果列表后面。
              实测（375×667，扩展集分片返回 500）：用户点第 1 条结果（y≈280）时，
              原本渲染在列表末尾的那条 <li> 落在 y=[885,919]，而列表可视区只到 y=630，
              且不会自动滚过去——屏上唯一的变化是右侧胶囊从「取数据…」变回「+ 入柜」，
              用户感知就是"点了没反应"，最可能的反应是反复点同一条。
              而真正的出口（手动记一瓶）就写在那条看不见的提示里。
              扩展集是 3.4 万款的唯一入柜通道，这条路不能是静默失败。
              role="status" 让读屏也能收到——原来那个 <li> 没有任何 aria 语义。 */}
          {extError && (
            <p
              role="status"
              className="border-b border-line bg-warn-wash px-4 py-2.5 text-[0.8rem] leading-relaxed text-warn"
            >
              这一瓶的数据没取到。稍后再试，或用下面的「手动记一瓶」。
            </p>
          )}
          {manualOpen ? (
            <ManualAdd
              initialName={q.trim()}
              onDone={() => {
                setManualOpen(false);
                setQ("");
              }}
              onCancel={() => setManualOpen(false)}
            />
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-5 text-center">
              <p className="text-sm text-ink-faint">没搜到。试试英文名或品牌名。</p>
              <button
                onClick={() => setManualOpen(true)}
                className="chip serif px-4 py-2 text-[0.85rem] hover:text-ink"
              >
                手动记一瓶 →
              </button>
            </div>
          ) : (
            /* 列表底边必须停在移动端底部导航之上：那条胶囊连同它的安全区占到 ~7rem，
               再留一点余量。否则最后一行（「都不是它？手动记一瓶」就钉在那里）
               永远压在导航带下面，怎么滚都点不到。 */
            <ul className="max-h-[min(60vh,calc(100dvh-19rem))] overflow-y-auto py-1">
              {items.map((it) => {
                if (it.source === "main") {
                  const p = it.p;
                  const added = inLib.has(p.id);
                  return (
                    <li key={`m${p.id}`}>
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
                          className={`ml-3 shrink-0 rounded-pill px-2.5 py-1 text-[0.74rem] ${
                            added ? "text-ink-faint" : "bg-ink text-paper"
                          }`}
                        >
                          {added ? "已在柜" : "+ 入柜"}
                        </span>
                      </button>
                    </li>
                  );
                }
                const e = it.e;
                const added = inLib.has(e.i);
                const busy = extBusyId === e.i;
                return (
                  <li key={`e${e.i}`}>
                    <button
                      disabled={added || busy}
                      onClick={() => addFromExt(e)}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-sunken disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <div className="min-w-0">
                        <div className="disp truncate text-[1rem] text-ink">{e.n}</div>
                        <div className="mt-0.5 truncate text-[0.74rem] text-ink-faint">{e.z || e.b}</div>
                      </div>
                      <span
                        className={`ml-3 shrink-0 rounded-pill px-2.5 py-1 text-[0.74rem] ${
                          added ? "text-ink-faint" : "bg-ink text-paper"
                        }`}
                      >
                        {added ? "已在柜" : busy ? "取数据…" : "+ 入柜"}
                      </span>
                    </button>
                  </li>
                );
              })}

              <li className="border-t border-line">
                <button
                  onClick={() => setManualOpen(true)}
                  className="w-full px-4 py-2.5 text-left text-[0.8rem] text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
                >
                  都不是它？手动记一瓶 →
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
