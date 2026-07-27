"use client";
// 客户端状态（香水库 + 反馈 + 偏好），持久化到 localStorage
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { z } from "zod";
import type { UserPerfume, Feedback, Occasion, ScenePatch, Perfume, WearEntry } from "./types";
import type { DemoState } from "./demo";
import { dayFloor } from "./recommend";

/** 一次移除所涉及的全部本地记录——撤销时原样放回 */
export interface RemovedBundle {
  userPerfume?: UserPerfume;
  extPerfume?: Perfume;
  customPerfume?: Perfume;
}

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
  // rehydrate 读盘失败时的原因。非空 = 盘上可能还有数据但没读出来，UI 必须停手并告知用户，
  // 绝不能表现成"新用户空香柜"然后用一次写入把仍然完整的备份覆盖掉。
  hydrateError: string | null;
  // 演示态：初次到访时自动装载的黄金集香柜（见 lib/demo.ts）。
  // demo=true 期间界面始终自报身份；dismissed 一旦为真就永不再自动装载——
  // 用户清空过一次之后，这台机器上的香柜就只属于他自己。
  demo: boolean;
  demoDismissed: boolean;
  // 证伪指标（本机埋点）：换香率与吃灰采纳率的原始计数——用来验证需求是否真实发生
  swapCount: number;
  dustyAdoptCount: number;

  addPerfume: (id: number) => void;
  addExtPerfume: (p: Perfume) => void;
  addCustomPerfume: (p: Perfume) => void;
  removePerfume: (id: number) => RemovedBundle;
  restorePerfume: (b: RemovedBundle) => void;
  markWorn: (id: number) => void;
  addFeedback: (fb: Feedback) => void;
  setCity: (c: string | null) => void;
  setOccasion: (o: Occasion) => void;
  setScene: (s: ScenePatch | null) => void;
  hasPerfume: (id: number) => boolean;
  enterDemo: (d: DemoState) => void;
  resetToDemo: (d: DemoState) => void;
  logWear: (entry: WearEntry) => void;
  setWearNote: (d: string, note: string) => void;
  recordSwap: (fromPerfumeId?: number) => void;
  recordDustyAdopt: () => void;
  exportData: () => string;
  previewImport: (raw: string) => ImportPreview | null;
  importData: (raw: string) => boolean;
}

/** 导入前的体检报告：让用户在覆盖发生**之前**看到自己要付出什么代价 */
export interface ImportPreview {
  perfumes: number;
  feedbacks: number;
  wearDays: number;
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
    // notes 必填：香气档案卡直接读 p.notes.top/middle/base，缺了就是点开即崩。
    // 校验面窄于消费面，等于把"宽进严出"的宽进做成了一个运行时炸弹——
    // 导入的坏数据不该在用户点进详情页时才爆出来。
    notes: z.object({
      top: z.array(z.string()),
      middle: z.array(z.string()),
      base: z.array(z.string()),
    }),
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

/** 持久化结构版本。改动 partialize 的字段结构时 +1，并在 migrate 里补上对应的迁移分支。 */
export const PERSIST_VERSION = 1;

/**
 * 用户在示例态下添加自己的第一瓶香水 → 示例香柜整体退场（「我的 · 数据」那一栏也是这么写的）。
 * 这是唯一诚实的语义：示例数据和真实数据混在同一个柜子里之后，
 * 推荐、香历、画像会同时基于"别人的六瓶"和"你的一瓶"作答，而用户无从分辨哪句是关于自己的。
 * 返回 null 表示当前不在示例态，调用方按原逻辑走。
 */
function demoExitPatch(s: { demo: boolean }) {
  return s.demo ? { ...DEMO_CLEARED, demo: false, demoDismissed: true } : null;
}

/** 示例香柜装进来的那几项——enterDemo 与 resetToDemo 共用一份，避免两处各写一遍再漂移 */
function demoPayload(d: DemoState) {
  return {
    demo: true,
    demoDismissed: false,
    userPerfumes: d.userPerfumes,
    feedbacks: d.feedbacks,
    wearLog: dedupeSortWear(d.wearLog),
    occasion: d.occasion,
  };
}

/** 演示态装进来的全部字段，退出时一次清干净（漏掉任何一项都会让演示数据残留在用户的真实香柜里） */
const DEMO_CLEARED = {
  userPerfumes: [] as UserPerfume[],
  feedbacks: [] as Feedback[],
  extPerfumes: [] as Perfume[],
  customPerfumes: [] as Perfume[],
  wearLog: [] as WearEntry[],
  swapAways: {} as Record<string, number[]>,
  swapCount: 0,
  dustyAdoptCount: 0,
};

// 香历不变式：按日去重（同日取后写）、按日期升序、封顶 730 天。
// 截断必须按日期而非插入序——否则补记/覆盖较早日期会把它挪到数组尾部，截掉的就不是最早的那天
function dedupeSortWear(entries: WearEntry[]): WearEntry[] {
  const byDay = new Map<string, WearEntry>();
  for (const e of entries) byDay.set(e.d, e);
  return [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d)).slice(-730);
}

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
      hydrateError: null,
      demo: false,
      demoDismissed: false,
      swapCount: 0,
      dustyAdoptCount: 0,

      addPerfume: (id) =>
        set((s) => {
          const base = demoExitPatch(s);
          if (!base && s.userPerfumes.some((u) => u.perfumeId === id)) return s;
          const cur = base ? DEMO_CLEARED : s;
          return {
            ...(base ?? {}),
            userPerfumes: [...cur.userPerfumes, { perfumeId: id, addedAt: Date.now() }],
          };
        }),
      // 扩展集入柜：完整记录快照随柜持久化（1500 之外的香不再进不了柜）
      addExtPerfume: (p) =>
        set((s) => {
          const base = demoExitPatch(s);
          const cur = base ? DEMO_CLEARED : s;
          return {
            ...(base ?? {}),
            extPerfumes: cur.extPerfumes.some((x) => x.id === p.id) ? cur.extPerfumes : [...cur.extPerfumes, p],
            userPerfumes: cur.userPerfumes.some((u) => u.perfumeId === p.id)
              ? cur.userPerfumes
              : [...cur.userPerfumes, { perfumeId: p.id, addedAt: Date.now() }],
          };
        }),
      // 按 id 去重（与 addPerfume/addExtPerfume 口径一致）：双击/并发不产生重复卡片
      addCustomPerfume: (p) =>
        set((s) => {
          const base = demoExitPatch(s);
          if (!base && s.customPerfumes.some((x) => x.id === p.id)) return s;
          const cur = base ? DEMO_CLEARED : s;
          return {
            ...(base ?? {}),
            customPerfumes: [...cur.customPerfumes, p],
            userPerfumes: cur.userPerfumes.some((u) => u.perfumeId === p.id)
              ? cur.userPerfumes
              : [...cur.userPerfumes, { perfumeId: p.id, addedAt: Date.now() }],
          };
        }),
      // 移除返回被删的整包快照，供「撤销」原样放回。
      // 手动记录的香水一旦删掉就再也搜不回来（数据只在这台机器上），不给后悔的机会是不可接受的。
      removePerfume: (id) => {
        const s = get();
        const removed: RemovedBundle = {
          userPerfume: s.userPerfumes.find((u) => u.perfumeId === id),
          extPerfume: s.extPerfumes.find((p) => p.id === id),
          customPerfume: s.customPerfumes.find((p) => p.id === id),
        };
        // swapAways 也要跟着走：它是按 perfumeId 存的换香时间戳，瓶子移出香柜后
        // 这些键再也不会被读到（recommend 只查在柜的瓶），却会一直占着 localStorage，
        // 加删反复几次就是永久累积。撤销时由 restorePerfume 不负责恢复它——
        // 隐式差评本来就该随瓶消失，重新入柜的是一个干净的开始。
        const swapAways = { ...s.swapAways };
        delete swapAways[String(id)];
        set({
          userPerfumes: s.userPerfumes.filter((u) => u.perfumeId !== id),
          extPerfumes: s.extPerfumes.filter((p) => p.id !== id),
          customPerfumes: s.customPerfumes.filter((p) => p.id !== id),
          swapAways,
        });
        return removed;
      },
      restorePerfume: (b) =>
        set((s) => ({
          userPerfumes:
            b.userPerfume && !s.userPerfumes.some((u) => u.perfumeId === b.userPerfume!.perfumeId)
              ? [...s.userPerfumes, b.userPerfume]
              : s.userPerfumes,
          extPerfumes:
            b.extPerfume && !s.extPerfumes.some((p) => p.id === b.extPerfume!.id)
              ? [...s.extPerfumes, b.extPerfume]
              : s.extPerfumes,
          customPerfumes:
            b.customPerfume && !s.customPerfumes.some((p) => p.id === b.customPerfume!.id)
              ? [...s.customPerfumes, b.customPerfume]
              : s.customPerfumes,
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
      // 装载演示香柜。只在空柜且从未退出过演示时由 AppProvider 调用一次（见那里的守卫），
      // 这里再自查一遍：任何时候都不能盖掉用户自己的数据。
      enterDemo: (d) =>
        set((s) =>
          s.demoDismissed || s.userPerfumes.length > 0 || s.customPerfumes.length > 0
            ? s
            : { ...demoPayload(d), city: s.city ?? d.city }
        ),
      // 重置到初次打开的样子：先把这台机器上的一切抹平，再把示例香柜原样装回来。
      //
      // 为什么"重置"要装回示例而不是留一个空柜：这个产品的**初始状态就是示例香柜**——
      // 新用户第一次打开看到的正是它。只清空不装回，反而到不了那副样子。
      //
      // 与 enterDemo 的区别是它**故意**越过那三道守卫：这是用户在「我的」里显式点下的动作，
      // 不是自动装载，清掉现有数据正是他要的结果。二次确认由调用方负责（见 profile 页）。
      // city / scene 一并复位——"初始状态"包含北京这座城市；调用方须随即重新解析一次天气，
      // 否则情境栏会停在旧城市的读数上，屏上的城市和天气对不上。
      resetToDemo: (d) => set(() => ({ ...DEMO_CLEARED, ...demoPayload(d), city: d.city, scene: null })),
      // 香历落账：一天一条、后写覆盖（同日改主意以最后一瓶为准），手记保留；按日期序封顶两年
      logWear: (entry) =>
        set((s) => {
          const prev = s.wearLog.find((e) => e.d === entry.d);
          const merged = { ...entry, note: entry.note ?? prev?.note };
          return { wearLog: dedupeSortWear([...s.wearLog, merged]) };
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
      // 导入是整包替换而非合并（合并要解决 id 冲突、时间线交错、反馈重复计数，语义上更危险）。
      // 既然是替换，就必须先让用户看清替换后是什么样——静默覆盖等于无声的数据丢失。
      previewImport: (raw) => {
        try {
          const parsed = ImportSchema.safeParse(JSON.parse(raw));
          if (!parsed.success) return null;
          const d = parsed.data;
          const userPerfumes = keepValid(d.userPerfumes, UserPerfumeSchema);
          if (userPerfumes.length === 0 && d.userPerfumes.length > 0) return null;
          return {
            perfumes: userPerfumes.length,
            feedbacks: keepValid(d.feedbacks, FeedbackSchema).length,
            wearDays: dedupeSortWear(keepValid(d.wearLog, WearEntrySchema) as WearEntry[]).length,
          };
        } catch {
          return null;
        }
      },
      // 返回 false 只能有一个含义：**文件被拒，状态一个字节都没动**。
      // 调用方据此告诉用户「导入没能完成，现在的数据没有被改动」——这句话必须永远为真。
      //
      // 原实现把整段（含 set）包在一个 try 里，于是写盘失败会走进 catch 返回 false，
      // 而此时内存状态**早已被替换**——UI 就会说出那句谎话。
      // 触发场景不是假想：localStorage 配额写满、Safari 隐私模式、存储被策略禁用，
      // `setItem` 都会抛。所以校验全部前置到 set 之前，set 之后一律视为已生效。
      importData: (raw) => {
        let d: z.infer<typeof ImportSchema>;
        let userPerfumes: UserPerfume[];
        try {
          const parsed = ImportSchema.safeParse(JSON.parse(raw));
          if (!parsed.success) return false;
          d = parsed.data;
          userPerfumes = keepValid(d.userPerfumes, UserPerfumeSchema);
          if (userPerfumes.length === 0 && d.userPerfumes.length > 0) return false; // 全坏 = 不是我们的备份
        } catch {
          return false;
        }
        try {
          set((s) => ({
            userPerfumes,
            feedbacks: keepValid(d.feedbacks, FeedbackSchema).slice(-400) as Feedback[],
            extPerfumes: keepValid(d.extPerfumes, PerfumeSnapshotSchema) as unknown as Perfume[],
            customPerfumes: keepValid(d.customPerfumes, PerfumeSnapshotSchema) as unknown as Perfume[],
            swapAways: d.swapAways ?? {},
            wearLog: dedupeSortWear(keepValid(d.wearLog, WearEntrySchema) as WearEntry[]),
            city: typeof d.city === "string" ? d.city : s.city,
            occasion: OCCASIONS.includes(d.occasion as Occasion) ? (d.occasion as Occasion) : s.occasion,
            swapCount: typeof d.swapCount === "number" ? d.swapCount : s.swapCount,
            dustyAdoptCount:
              typeof d.dustyAdoptCount === "number" ? d.dustyAdoptCount : s.dustyAdoptCount,
            // 导入自己的备份 = 这台机器从此属于用户，演示香柜退场且不再自动装载
            demo: false,
            demoDismissed: true,
          }));
        } catch {
          // zustand 的 persist 是先改内存、再写盘，所以抛到这里时状态**已经换掉了**。
          // 写盘失败（配额满 / 隐私模式 / 存储被禁）不该反过来报告成"没有改动"——
          // 那是这次修复要消灭的那句谎话。这里吞掉异常但仍返回 true。
          // 已知局限：写盘失败本身没有对用户暴露。但这个暴露面是全局的
          //（addPerfume / addFeedback 等每一次写入都一样），不该只在导入这一处单独处理。
        }
        return true;
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
        demo: s.demo,
        demoDismissed: s.demoDismissed,
      }),
      // 版本与迁移。**没有这两项才是真正的危险**：zustand 在 version 不匹配又没有 migrate 时
      // 会 console.error 后整包丢弃持久化数据，而下一次写入立刻把盘上的备份覆盖成空。
      // 所以哪怕迁移函数暂时无事可做，它也必须先存在——等到要改结构那天再补就晚了。
      version: PERSIST_VERSION,
      migrate: (persisted, from) => {
        const s = (persisted ?? {}) as Record<string, unknown>;
        // v0 → v1：新增 demo / demoDismissed。
        // 判据是"这台机器上有没有他自己的瓶"，不是"是不是老记录"——
        // 一律置 dismissed 会把「来过一次、柜子还空着」的人也挡在演示之外，
        // 而那恰恰是最该看到演示的人；反过来，已经有瓶的人绝不能被装上别人的六瓶。
        if (from < 1) {
          const own = Array.isArray(s.userPerfumes) ? s.userPerfumes.length : 0;
          const custom = Array.isArray(s.customPerfumes) ? s.customPerfumes.length : 0;
          s.demo = false;
          s.demoDismissed = own > 0 || custom > 0;
        }
        return s;
      },
      // 必须走 setState：直接写 state.hydrated 只是就地改对象，不触发 zustand 的订阅通知。
      // 只订阅 hydrated、没有别的状态源顺带触发重渲染的页面（/香历）会永远停在骨架屏。
      //
      // 两个入参都必须接住。读盘失败时 zustand 只会带着 error 调这个回调、state 保持初始空值，
      // 于是"读不出来"和"新用户"在界面上长得一模一样——用户看到一个正常渲染的空香柜，
      // 随手加一瓶，这次写入就把盘上仍然完整的数据覆盖掉了。
      // 所以出错时先把原始字符串另存一份，再置错误标志让 UI 停手（见 AppProvider 的 HydrateError）。
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          try {
            const raw = window.localStorage.getItem("fencun-store");
            if (raw) window.localStorage.setItem("fencun-store.bak", raw);
          } catch {
            // 备份本身失败（存储被禁/配额满）也不能让流程卡住，错误标志仍要立起来
          }
          useStore.setState({ hydrated: true, hydrateError: String(error) });
          return;
        }
        useStore.setState({ hydrated: true, hydrateError: null });
      },
    }
  )
);
