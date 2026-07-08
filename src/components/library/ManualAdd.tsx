"use client";
// 手动记一瓶：搜索兜底的最后防线——1500 主目录和 3.6 万扩展集都没有的香（停产、小众、自调），
// 也要能进柜、能参与推荐。没有社区数据，就按所选香调的典型情况估计，靠反馈校准。
import { useState } from "react";
import { useStore } from "@/lib/store";
import type { Perfume, Accord } from "@/lib/types";

// 香调预设：en 供打分规则匹配，zh 与全站映射口径一致（data/zh-map/accords.json）
const FAMILIES: { key: string; label: string; accords: Accord[] }[] = [
  { key: "citrus", label: "柑橘清新", accords: [{ en: "citrus", zh: "柑橘", strength: 60 }, { en: "fresh", zh: "清新", strength: 40 }] },
  { key: "aquatic", label: "水生海洋", accords: [{ en: "aquatic", zh: "水生", strength: 60 }, { en: "marine", zh: "海洋", strength: 35 }] },
  { key: "green", label: "绿意草本", accords: [{ en: "green", zh: "绿叶", strength: 55 }, { en: "aromatic", zh: "馥郁草本", strength: 45 }] },
  { key: "floral", label: "花香", accords: [{ en: "floral", zh: "花香", strength: 60 }] },
  { key: "white_floral", label: "白花", accords: [{ en: "white floral", zh: "白花", strength: 60 }] },
  { key: "rose", label: "玫瑰", accords: [{ en: "rose", zh: "玫瑰", strength: 60 }] },
  { key: "fruity", label: "果香", accords: [{ en: "fruity", zh: "果香", strength: 60 }] },
  { key: "sweet", label: "甜香草", accords: [{ en: "sweet", zh: "甜调", strength: 55 }, { en: "vanilla", zh: "香草", strength: 45 }] },
  { key: "woody", label: "木质", accords: [{ en: "woody", zh: "木质", strength: 60 }] },
  { key: "spicy", label: "辛香", accords: [{ en: "warm spicy", zh: "暖辛香", strength: 55 }] },
  { key: "amber", label: "琥珀", accords: [{ en: "amber", zh: "琥珀", strength: 55 }] },
  { key: "leather", label: "皮革烟熏", accords: [{ en: "leather", zh: "皮革", strength: 50 }, { en: "smoky", zh: "烟熏", strength: 40 }] },
  { key: "musky", label: "粉感麝香", accords: [{ en: "powdery", zh: "粉感", strength: 55 }, { en: "musky", zh: "麝香", strength: 45 }] },
];

const SILLAGE_OPTIONS: { tier: 1 | 2 | 3 | 4; label: string; sillage: number }[] = [
  { tier: 1, label: "贴肤", sillage: 1.4 },
  { tier: 2, label: "一臂", sillage: 2.1 },
  { tier: 3, label: "一桌", sillage: 2.7 },
  { tier: 4, label: "满室", sillage: 3.4 },
];

export function ManualAdd({ initialName, onDone }: { initialName?: string; onDone: () => void }) {
  const addCustomPerfume = useStore((s) => s.addCustomPerfume);
  const [name, setName] = useState(initialName ?? "");
  const [brand, setBrand] = useState("");
  const [fams, setFams] = useState<string[]>([]);
  const [tier, setTier] = useState<1 | 2 | 3 | 4>(2);

  const canSave = name.trim().length > 0 && fams.length > 0;

  function toggleFam(key: string) {
    setFams((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : cur.length >= 3 ? cur : [...cur, key]
    );
  }

  function save() {
    if (!canSave) return;
    const nm = name.trim();
    const br = brand.trim();
    const accords: Accord[] = [];
    for (const f of FAMILIES) {
      if (!fams.includes(f.key)) continue;
      for (const a of f.accords) if (!accords.some((x) => x.en === a.en)) accords.push(a);
    }
    accords.sort((a, b) => b.strength - a.strength);
    const sil = SILLAGE_OPTIONS.find((o) => o.tier === tier)!;
    const hasCJK = /[一-鿿]/.test(nm);
    const p: Perfume = {
      id: -Date.now(), // 负数 id：永不与数据集冲突
      name: nm,
      nameZh: hasCJK ? nm : null,
      aliases: [],
      brand: br || "未注品牌",
      brandZh: br || "未注品牌",
      gender: "unisex",
      year: null,
      rating: null,
      longevity: null, // 无社区数据 → 留香话术自动落"因人而异"，不编数字
      sillage: sil.sillage,
      sillageTier: tier,
      priceValue: null,
      seasonPct: { winter: 0.25, spring: 0.25, summer: 0.25, autumn: 0.25 }, // 季节中性，不假装知道
      daypartPct: { day: 0.5, night: 0.5 },
      accords,
      notes: { top: [], middle: [], base: [] },
      notesFlat: [],
      styleTags: ["手动记录"],
      popularity: 0,
      people: 0,
      custom: true,
    };
    addCustomPerfume(p);
    onDone();
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <p className="serif text-[0.82rem] leading-relaxed text-ink-faint">
        没搜到也能记下来。挑 1–3 个最像它的香调，推荐就能带上它——用两次并反馈后会更准。
      </p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="香水名（必填）"
        className="w-full rounded-md border border-line-strong bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <input
        value={brand}
        onChange={(e) => setBrand(e.target.value)}
        placeholder="品牌（选填）"
        className="w-full rounded-md border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <div>
        <p className="mb-1.5 text-[0.74rem] text-ink-faint">它闻起来像（选 1–3 个）</p>
        <div className="flex flex-wrap gap-1.5">
          {FAMILIES.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={fams.includes(f.key)}
              onClick={() => toggleFam(f.key)}
              className={`chip px-2.5 py-1.5 text-[0.8rem] ${
                fams.includes(f.key) ? "border-accent text-accent" : ""
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[0.74rem] text-ink-faint">扩散大概是</p>
        <div className="flex gap-1.5">
          {SILLAGE_OPTIONS.map((o) => (
            <button
              key={o.tier}
              type="button"
              aria-pressed={tier === o.tier}
              onClick={() => setTier(o.tier)}
              className={`chip flex-1 py-1.5 text-[0.8rem] ${tier === o.tier ? "border-accent text-accent" : ""}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        disabled={!canSave}
        onClick={save}
        className="btn-primary py-2.5 text-[0.88rem] disabled:opacity-50"
      >
        记下这瓶，入柜
      </button>
    </div>
  );
}
