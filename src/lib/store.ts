"use client";
// 客户端状态（香水库 + 反馈 + 偏好），持久化到 localStorage
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { z } from "zod";
import type { UserPerfume, Feedback, Occasion, ScenePatch, Perfume, WearEntry } from "./types";
import { dayFloor } from "./recommend";

interface State {
  userPerfumes: UserPerfume[];
  feedbacks: Feedback[];
  extPerfumes: Perfume[]; // 扩展集（Top1500 之外）入柜香水的完整记录快照——离线可用，不依赖分片重取
  customPerfumes: Perfume[]; // 手动记录的香水（负数 id）
  swapAways: Record<string, number[]>; // perfumeId → 最近被从主推位换掉的时间戳（隐式差评原料，各留 10 条）
  wearLog: WearEntry[]; // 香历：一天一条，采纳/反馈时自动落账——记录资产，随时间增值
  city: string | null; // 手动城市覆盖（定位失败时用）
  occasion: Occasion;
  scene: ScenePatch | null; // 自然语言场景（覆盖 occasion）
  hydrated: boolean;
  // 证伪指标（本机埋点）：换香率与吃灰采纳率的原始计数——用来验证需求是否真实发生
  swapCount: number;
  dustyAdoptCount: number;

  addPerfume: (id: number) => void;
  addExtPerfume: (p: Perfume) => void;
  addCustomPerfume: (p: Perfume) => void;
  removePerfume: (id: number) => void;
  markWorn: (id: number) => void;
  addFeedback: (fb: Feedback) => void;
  setCity: (c: string | null) => void;
  setOccasion: (o: Occasion) => void;
  setScene: (s: ScenePatch | null) => void;
  hasPerfume: (id: number) => boolean;
  logWear: (entry: WearEntry) => void;
  setWearNote: (d: string, note: string) => void;
  recordSwap: (fromPerfumeId?: number) => void;
  recordDustyAdopt: () => void;
  exportData: () => string;
  importData: (raw: string) => boolean;
}

// 导入校验：数据在本机，导入导出就是官方备份路径——它的健壮性等于数据安全。
// 宽进严出：整体结构必须对，坏掉的单条记录丢弃而非整包拒收。
const UserPerfumeSchema = z.object({
  perfumeId: z.number().int(),
  addedAt: z.number(),
  lastWornAt: z.number().optional(),
  wornCount: z.number().int().min(0).optional(),
  bias: z.object({ likeScore: z.number(), perceivedStrength: z.number() }).optional(),
});
const FeedbackSchema = z.object({
  perfumeId: z.number().int(),
  at: z.number(),
  context: z.object({
    season: z.enum(["winter", "spring", "summer", "autumn"]),
    daypart: z.enum(["day", "night"]),
    tempC: z.number(),
    occasion: z.enum(["commute", "work", "date", "social", "formal", "casual", "home", "sport"]),
    feel: z.enum(["hot_humid", "hot_dry", "mild", "cold"]).optional(),
    humidity: z.number().optional(),
  }),
  rating: z.enum(["too_weak", "perfect", "too_strong", "scene_mismatch"]),
  sprays: z.tuple([z.number(), z.number()]).optional(),
  tags: z.array(z.string()).optional(),
});
const PerfumeSnapshotSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    nameZh: z.string().nullable(),
    aliases: z.array(z.string()),
    brand: z.string(),
    brandZh: z.string(),
    gender: z.enum(["male", "female", "unisex"]),
    accords: z.array(z.object({ en: z.string(), zh: z.string(), strength: z.number() })),
    seasonPct: z.object({ winter: z.number(), spring: z.number(), summer: z.number(), autumn: z.number() }),
    daypartPct: z.object({ day: z.number(), night: z.number() }),
    sillageTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    styleTags: z.array(z.string()),
  })
  .loose();
const ImportSchema = z
  .object({
    userPerfumes: z.array(z.unknown()),
    feedbacks: z.array(z.unknown()).optional(),
    extPerfumes: z.array(z.unknown()).optional(),
    customPerfumes: z.array(z.unknown()).optional(),
    swapAways: z.record(z.string(), z.array(z.number())).optional(),
    wearLog: z.array(z.unknown()).optional(),
    city: z.string().nullable().optional(),
    occasion: z.string().optional(),
    swapCount: z.number().optional(),
    dustyAdoptCount: z.number().optional(),
  })
  .loose();

const WearEntrySchema = z.object({
  d: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  perfumeId: z.number().int(),
  name: z.string().max(120),
  fam: z.string().max(20),
  occasion: z.enum(["commute", "work", "date", "social", "formal", "casual", "home", "sport"]),
  tempC: z.number().nullable(),
  weatherText: z.string().max(40),
  feel: z.enum(["hot_humid", "hot_dry", "mild", "cold"]),
  note: z.string().max(200).optional(),
});

const OCCASIONS: Occasion[] = ["commute", "work", "date", "social", "formal", "casual", "home", "sport"];

function keepValid<T>(items: unknown[] | undefined, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(items)) return [];
  const out: T[] = [];
  for (const it of items) {
    const r = schema.safeParse(it);
    if (r.success) out.push(r.data);
  }
  return out;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      userPerfumes: [],
      feedbacks: [],
      extPerfumes: [],
      customPerfumes: [],
      swapAways: {},
      wearLog: [],
      city: null,
      occasion: "commute",
      scene: null,
      hydrated: false,
      swapCount: 0,
      dustyAdoptCount: 0,

      addPerfume: (id) =>
        set((s) =>
          s.userPerfumes.some((u) => u.perfumeId === id)
            ? s
            : { userPerfumes: [...s.userPerfumes, { perfumeId: id, addedAt: Date.now() }] }
        ),
      // 扩展集入柜：完整记录快照随柜持久化（1500 之外的香不再进不了柜）
      addExtPerfume: (p) =>
        set((s) => ({
          extPerfumes: s.extPerfumes.some((x) => x.id === p.id) ? s.extPerfumes : [...s.extPerfumes, p],
          userPerfumes: s.userPerfumes.some((u) => u.perfumeId === p.id)
            ? s.userPerfumes
            : [...s.userPerfumes, { perfumeId: p.id, addedAt: Date.now() }],
        })),
      // 按 id 去重（与 addPerfume/addExtPerfume 口径一致）：双击/并发不产生重复卡片
      addCustomPerfume: (p) =>
        set((s) =>
          s.customPerfumes.some((x) => x.id === p.id)
            ? s
            : {
                customPerfumes: [...s.customPerfumes, p],
                userPerfumes: s.userPerfumes.some((u) => u.perfumeId === p.id)
                  ? s.userPerfumes
                  : [...s.userPerfumes, { perfumeId: p.id, addedAt: Date.now() }],
              }
        ),
      removePerfume: (id) =>
        set((s) => ({
          userPerfumes: s.userPerfumes.filter((u) => u.perfumeId !== id),
          extPerfumes: s.extPerfumes.filter((p) => p.id !== id),
          customPerfumes: s.customPerfumes.filter((p) => p.id !== id),
        })),
      // 采纳（换香/吃灰/反馈提交）→ 记一笔穿戴：刷新 lastWornAt（吃灰口径）。
      // wornCount（常喷口径）同一天只累计一次——反馈+采纳双路径不再虚增
      markWorn: (id) =>
        set((s) => ({
          userPerfumes: s.userPerfumes.map((u) => {
            if (u.perfumeId !== id) return u;
            const now = Date.now();
            const sameDay = u.lastWornAt != null && dayFloor(u.lastWornAt) === dayFloor(now);
            return { ...u, lastWornAt: now, wornCount: (u.wornCount ?? 0) + (sameDay ? 0 : 1) };
          }),
        })),
      // 同瓶同日重复反馈 → 以最新一条为准（刷新页面重复提交不再重复计入偏置）；
      // 窗口按瓶分桶（各 60 条）+ 全局 400 条，对 A 瓶狂点不再把 B 瓶的历史挤出窗口
      addFeedback: (fb) =>
        set((s) => {
          let next = s.feedbacks.filter(
            (f) => !(f.perfumeId === fb.perfumeId && dayFloor(f.at) === dayFloor(fb.at))
          );
          next = [...next, fb];
          const mine = next.filter((f) => f.perfumeId === fb.perfumeId);
          if (mine.length > 60) {
            const cutoff = mine[mine.length - 61].at;
            next = next.filter((f) => f.perfumeId !== fb.perfumeId || f.at > cutoff);
          }
          return { feedbacks: next.slice(-400) };
        }),
      setCity: (c) => set({ city: c }),
      setOccasion: (o) => set({ occasion: o, scene: null }), // 手动选场合即清除自然语言场景
      setScene: (s) => set({ scene: s }),
      hasPerfume: (id) => get().userPerfumes.some((u) => u.perfumeId === id),
      // 香历落账：一天一条、后写覆盖（同日改主意以最后一瓶为准），手记保留；封顶两年
      logWear: (entry) =>
        set((s) => {
          const prev = s.wearLog.find((e) => e.d === entry.d);
          const merged = { ...entry, note: entry.note ?? prev?.note };
          return { wearLog: [...s.wearLog.filter((e) => e.d !== entry.d), merged].slice(-730) };
        }),
      setWearNote: (d, note) =>
        set((s) => ({
          wearLog: s.wearLog.map((e) => (e.d === d ? { ...e, note: note.trim() || undefined } : e)),
        })),
      // 换瓶 = 隐式差评：记下"哪瓶在什么时候被从主推位换掉"（每瓶留最近 10 条）
      recordSwap: (fromPerfumeId) =>
        set((s) => {
          const swapAways = { ...s.swapAways };
          if (fromPerfumeId != null) {
            const k = String(fromPerfumeId);
            swapAways[k] = [...(swapAways[k] ?? []), Date.now()].slice(-10);
          }
          return { swapCount: s.swapCount + 1, swapAways };
        }),
      recordDustyAdopt: () => set((s) => ({ dustyAdoptCount: s.dustyAdoptCount + 1 })),
      exportData: () => {
        const s = get();
        return JSON.stringify(
          {
            version: 2,
            exportedAt: Date.now(),
            userPerfumes: s.userPerfumes,
            feedbacks: s.feedbacks,
            extPerfumes: s.extPerfumes,
            customPerfumes: s.customPerfumes,
            swapAways: s.swapAways,
            wearLog: s.wearLog,
            city: s.city,
            occasion: s.occasion,
            swapCount: s.swapCount,
            dustyAdoptCount: s.dustyAdoptCount,
          },
          null,
          2
        );
      },
      importData: (raw) => {
        try {
          const parsed = ImportSchema.safeParse(JSON.parse(raw));
          if (!parsed.success) return false;
          const d = parsed.data;
          const userPerfumes = keepValid(d.userPerfumes, UserPerfumeSchema);
          if (userPerfumes.length === 0 && d.userPerfumes.length > 0) return false; // 全坏 = 不是我们的备份
          set((s) => ({
            userPerfumes,
            feedbacks: keepValid(d.feedbacks, FeedbackSchema).slice(-400) as Feedback[],
            extPerfumes: keepValid(d.extPerfumes, PerfumeSnapshotSchema) as unknown as Perfume[],
            customPerfumes: keepValid(d.customPerfumes, PerfumeSnapshotSchema) as unknown as Perfume[],
            swapAways: d.swapAways ?? {},
            wearLog: (keepValid(d.wearLog, WearEntrySchema) as WearEntry[]).slice(-730),
            city: typeof d.city === "string" ? d.city : s.city,
            occasion: OCCASIONS.includes(d.occasion as Occasion) ? (d.occasion as Occasion) : s.occasion,
            swapCount: typeof d.swapCount === "number" ? d.swapCount : s.swapCount,
            dustyAdoptCount:
              typeof d.dustyAdoptCount === "number" ? d.dustyAdoptCount : s.dustyAdoptCount,
          }));
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: "fencun-store",
      // 服务端无 localStorage → 返回 undefined，persist 自动跳过；客户端正常持久化
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : (undefined as unknown as Storage)
      ),
      // 跳过自动 hydrate，改由 AppProvider 在挂载后手动 rehydrate，避免 SSR/客户端首屏不一致
      skipHydration: true,
      partialize: (s) => ({
        userPerfumes: s.userPerfumes,
        feedbacks: s.feedbacks,
        extPerfumes: s.extPerfumes,
        customPerfumes: s.customPerfumes,
        swapAways: s.swapAways,
        wearLog: s.wearLog,
        city: s.city,
        occasion: s.occasion,
        swapCount: s.swapCount,
        dustyAdoptCount: s.dustyAdoptCount,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    }
  )
);
