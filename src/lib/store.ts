"use client";
// 客户端状态（香水库 + 反馈 + 偏好），持久化到 localStorage
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { z } from "zod";
import type { UserPerfume, Feedback, Occasion, ScenePatch, Perfume, WearEntry } from "./types";
import type { DemoState } from "./demo";
import { DEMO_CITY } from "./demo";
import { dayFloor } from "./recommend";

/** 一次移除所涉及的全部本地记录——撤销时原样放回 */
export interface RemovedBundle {
  userPerfume?: UserPerfume;
  extPerfume?: Perfume;
  customPerfume?: Perfume;
}

/**
 * 一次「采纳」之前的现场快照——撤销时原样放回。
 *
 * 为什么需要它：「也可以考虑」「从你的香柜里选」两个入口的文案都是纯浏览语义，
 * 点一下却立刻写三笔——markWorn 刷新 lastWornAt 并让 wornCount+1、
 * logWear 按日后写覆盖当天香历、recordSwap 记一笔隐式差评。
 * 想比三瓶用法，三瓶就全被记成今天穿过：轮换的新鲜度因子与吃灰的 21 天计时一起重置，
 * 产品自称的价值重心「发现型钩子」被一次浏览动作打哑；wornCount 又是天气突变预警
 * 判「你常喷的那瓶」的唯一依据。而右上角那个回退箭头只清选中态，看起来像撤销、
 * 实际什么都不回滚——那比没有撤销更糟。
 */
export interface AdoptSnapshot {
  perfumeId: number;
  userPerfume: UserPerfume | null;
  day: string;
  wearEntry: WearEntry | null;
  swapCount: number;
  dustyAdoptCount: number;
  swapAways: Record<string, number[]>;
}

/** 当前城市名是怎么来的。判据见 State.cityOrigin 的说明 */
export type CityOrigin = "none" | "demo" | "geo" | "manual";

/**
 * 拿到城市之后，还要不要再问一次定位。
 *
 * 只有 manual 不问——那是用户亲手指定的，自动定位没有资格覆盖它。
 * 其余三种都问：demo/none 是因为还不知道用户在哪，geo 是因为用户会出差、会搬家。
 *
 * 抽成纯函数是为了可测：navigator.geolocation 在 node --test 下造不出来，判据可以。
 */
export function shouldAskGeolocation(origin: CityOrigin): boolean {
  return origin !== "manual";
}

interface State {
  userPerfumes: UserPerfume[];
  feedbacks: Feedback[];
  extPerfumes: Perfume[]; // 扩展集（Top1500 之外）入柜香水的完整记录快照——离线可用，不依赖分片重取
  customPerfumes: Perfume[]; // 手动记录的香水（负数 id）
  swapAways: Record<string, number[]>; // perfumeId → 最近被从主推位换掉的时间戳（隐式差评原料，各留 10 条）
  wearLog: WearEntry[]; // 香历：一天一条，采纳/反馈时自动落账——记录资产，随时间增值
  city: string | null; // 当前生效的城市名
  // 这个城市**是怎么来的**。只存城市名不够：同样是「北京」，用户亲手填的和演示态兜底给的，
  // 下次打开时该做的事完全相反——前者要照办，后者要重新问一次定位。
  //
  // 不区分的代价实测过：演示态自带 city="北京"，退场时 DEMO_CLEARED 又没清它，
  // 于是 AppProvider 的 `if (city) fetchByCity(city) else resolveByCoords()` 永远走左边，
  // resolveByCoords 对**每一个**经过演示香柜的用户（即所有首访者）一次都没跑过——
  // 实时天气是这个产品的核心输入，全线上用户拿到的都是北京的读数。
  //
  // · manual —— 用户在情境栏亲手指定，最高优先级，不再自动覆盖
  // · geo    —— 定位成功后反查得到，仍会在每次打开时刷新（用户会出差、会搬家）
  // · demo   —— 演示态兜底，只为首屏有天气可看；每次打开都要再申请一次定位
  // · none   —— 没有城市，直接走定位
  cityOrigin: CityOrigin;
  occasion: Occasion;
  scene: ScenePatch | null; // 自然语言场景（覆盖 occasion）
  hydrated: boolean;
  // rehydrate 读盘失败时的原因。非空 = 盘上可能还有数据但没读出来，UI 必须停手并告知用户，
  // 绝不能表现成"新用户空香柜"然后用一次写入把仍然完整的备份覆盖掉。
  hydrateError: string | null;
  // **写盘**失败时的原因。读盘那一半早就有告知通道了，写盘这一半一直没接上——
  // 而在存储不可写的设备上，用户加香水、记用香、留反馈每一步都显示成功，刷新后全没：
  // profile 页正写着「你的香柜与全部反馈只存在本机浏览器」，那是这个产品唯一的数据副本。
  persistError: string | null;
  // 盘上的数据在本页开着的时候被抹掉了（浏览器的「清除本站数据」、另一标签页 clear()）。
  // 内存里这一份是唯一的幸存者，但它已经不许再落盘——去留由用户决定，我们只负责说清楚。
  storageWiped: boolean;
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
  /** 采纳前留一份现场（见 AdoptSnapshot），交给 UI 拿去做 8 秒撤销 */
  snapshotAdopt: (id: number, day: string) => AdoptSnapshot;
  /** 把 snapshotAdopt 那一刻的现场原样放回。传一串则整串回滚到**第一张**之前 */
  undoAdopt: (s: AdoptSnapshot | AdoptSnapshot[]) => void;
  addFeedback: (fb: Feedback) => void;
  setCity: (c: string | null) => void;
  /** 定位反查到的城市。与 setCity 分开，是因为来源不同、下次打开时的处置也不同 */
  setGeoCity: (c: string) => void;
  /** 盘被抹掉了：冻结写入并立起标志。顺序与读盘失败分支一致——先冻结，再 setState */
  noteStorageWiped: () => void;
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
  /** 读盘失败时另存的那份原始字节还在不在——决定要不要给用户「试着恢复」这条路 */
  hasRescueBackup: () => boolean;
  /** 拿 fencun-store.bak 里的字节走一次导入。返回 false = 一个字节都没动 */
  restoreFromBackup: () => boolean;
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
  // 不再校验 bias：那个字段从来没被写过（偏置是 aggregateBias 每次现算的）。
  // 老备份里若带着它，zod 默认剥掉未声明的键，导入照常成功。
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
export const PERSIST_VERSION = 2;

/**
 * 导出文件的格式版本。**与 PERSIST_VERSION 互不相干**：一个描述 localStorage 里的结构，
 * 一个描述导出的 JSON 文件的结构，各自演进。此前两个数字散在两处、都写成字面量，
 * 谁跟谁一致纯属巧合——今天不产生任何错误行为，但改导出格式那天就是埋雷。
 */
export const EXPORT_VERSION = 2;

/** 持久化的键。listener 要按它过滤 storage 事件，所以不能只写在 persist 配置里 */
export const STORE_KEY = "fencun-store";

/** 读盘失败时另存原始字节的键 */
const BACKUP_KEY = "fencun-store.bak";

/**
 * 另一个标签页写盘之后，这一页要不要跟着重读。
 *
 * 不重读的代价是**整包覆盖**：两个标签页各自持有一份内存态，persist 是全量写、没有 merge，
 * 于是旧标签页的下一次点击会把另一页刚写下的香柜、香历与手记一起盖掉，
 * 连「演示香柜已退场」这个标记也会被盖回去、六瓶示例复活。
 * 而这些数据只有本机一份、没有云端，覆盖不可逆。
 *
 * 两个边界：
 * · 盘被清空（`localStorage.clear()` 或把这个键 removeItem）**不能**走重读，见 isStorageWipe；
 * · 读盘出过错时写入已经被冻结（见 onRehydrateStorage），这时一切自动动作都要停手。
 *
 * 抽成纯函数是为了可测：浏览器事件本身在 node --test 下造不出来，判据可以。
 */
export function shouldRehydrateOnStorage(
  key: string | null,
  newValue: string | null,
  hydrateError: string | null
): boolean {
  if (hydrateError) return false;
  if (isStorageWipe(key, newValue)) return false;
  return key === STORE_KEY;
}

/**
 * 这次 storage 事件是不是「盘被清空了」。
 *
 * `key === null` 是 `localStorage.clear()`；`key === STORE_KEY && newValue === null`
 * 是 removeItem。两者都表示用户（或浏览器的「清除本站数据」）把这份数据抹掉了。
 *
 * ⚠️ 这里**绝不能**走 rehydrate。zustand 在盘上取不到值时会 `merge(undefined, get())`，
 * 也就是把内存态原样留着，随后 onRehydrateStorage 的成功分支一句 setState 又被 persist
 * 立刻写回盘——净效果是「清空」被撤销。实测过：写入 331 字节（含用户手记）→ clear() →
 * 盘上为空 → rehydrate() → 331 字节连同手记原样回来。
 *
 * 那条注释原本写的是「继续按旧状态写回去只会造出一份半新半旧的数据」，方向是对的，
 * 只是当时把「重读」当成了避免它的手段，而重读恰恰是执行它的手段。
 *
 * 正确的动作和读盘失败时一样：冻结写入 + 告诉用户，把去留交还给他。
 */
export function isStorageWipe(key: string | null, newValue: string | null): boolean {
  return key === null || (key === STORE_KEY && newValue === null);
}

/**
 * 用户在示例态下添加自己的第一瓶香水 → 示例香柜整体退场（「我的 · 数据」那一栏也是这么写的）。
 * 这是唯一诚实的语义：示例数据和真实数据混在同一个柜子里之后，
 * 推荐、香历、画像会同时基于"别人的六瓶"和"你的一瓶"作答，而用户无从分辨哪句是关于自己的。
 * 返回 null 表示当前不在示例态，调用方按原逻辑走。
 */
function demoExitPatch(s: { demo: boolean; wearLog: WearEntry[] }) {
  if (!s.demo) return null;
  // 演示的六瓶、那一个月的穿香记录、示例反馈全都该走干净——但**用户亲手打的手记不是演示数据**。
  // 香历页对演示条目和真实条目一视同仁地可写（这是对的，不写字的日历没人会用），
  // 于是有人会在示例的某一天里写下一句真话，然后加进自己的第一瓶香，那句话就无声消失了。
  // 只保留带 note 的那几条，其余照旧清空。
  const kept = s.wearLog.filter((e) => e.note && e.note.trim().length > 0);
  return { ...DEMO_CLEARED, wearLog: dedupeSortWear(kept), demo: false, demoDismissed: true };
}

/**
 * 拿 localStorage 句柄。**读这个属性本身就可能抛**——Chrome 的「阻止所有 Cookie」、
 * 跨源沙箱 iframe、Firefox 关掉 dom.storage 都是这条路径，不是罕见到可以不管的场景。
 * 抛了就返回 null，让整个应用退到"不持久化但能用"，而不是白屏。
 */
function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 读盘失败之后**冻结写入**，保住盘上还没读出来的那些字节。
 *
 * 这不是多此一举：zustand 的 setState 被 persist 包成「先改内存、再无条件写盘」，
 * 所以 onRehydrateStorage 错误分支里那句 `setState({ hydrated, hydrateError })`
 * 本身就会把内存里的初始空态整包写回盘——止损代码自己完成了它要阻止的那次覆盖，
 * 而且发生在 SiteNotice 渲染之前。连锁后果：第二次打开时盘上是一份合法的空 JSON，
 * hydrateError 归零、警告永久消失，演示香柜还会顶上来——数据和"数据出过事"的证据一起没了。
 *
 * 用户成功导入备份后解冻（见 importData）：那时这台机器上该有什么已经由他自己说了算。
 */
let writesFrozen = false;

/**
 * 把一个真实的 Storage 包成「写失败不抛、只上报」的形状。
 * 单独抽出来是为了能对着一个会抛的桩做单测——它守的是产品唯一那份数据副本的告知义务。
 */
export function guardedStorage(
  ls: Storage,
  onWriteError: (e: unknown) => void,
  canWrite: () => boolean = () => true
): Storage {
  return {
    getItem: (k: string) => ls.getItem(k),
    removeItem: (k: string) => ls.removeItem(k),
    setItem: (k: string, v: string) => {
      if (!canWrite()) return;
      try {
        ls.setItem(k, v);
      } catch (e) {
        onWriteError(e);
      }
    },
  } as Storage;
}

/**
 * 「这台机器上已经有属于他自己的东西了吗」——示例香柜能不能装载，只由这一个判据说了算。
 *
 * 判据必须覆盖 demoPayload 会替换掉的**每一项**，不能只看瓶子。
 * types.ts 把「瓶子移出香柜之后，香历里的记录依然完整」写成了产品承诺，
 * 于是「柜已清空、香历与反馈还在」是这个产品自己设计出来的合法状态——
 * 只看 userPerfumes 就会把它判成「一台全新的空机器」，然后用示例数据把香历
 *（含用户手写的手记）和反馈序列整包换掉。而这条路径**不写 .bak**：
 * 与读盘失败那条不同，它没有任何可恢复的字节留下。
 * 被抹掉的恰恰是这个产品自称的唯一壁垒（反馈序列）与唯一记录资产（香历）。
 *
 * 入参写成宽松形状是有意的：migrate 拿到的是尚未校验的 Record<string, unknown>，
 * 三个调用点必须用同一个函数，否则口径迟早再次漂移——这次的教训正是"同一条判据写了三遍"。
 */
export function hasOwnData(s: Record<string, unknown>): boolean {
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  return (
    len(s.userPerfumes) > 0 ||
    len(s.customPerfumes) > 0 ||
    len(s.extPerfumes) > 0 ||
    len(s.wearLog) > 0 ||
    len(s.feedbacks) > 0 ||
    num(s.swapCount) > 0 ||
    num(s.dustyAdoptCount) > 0
  );
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
      cityOrigin: "none",
      occasion: "commute",
      scene: null,
      hydrated: false,
      hydrateError: null,
      storageWiped: false,
      persistError: null,
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
      snapshotAdopt: (id, day) => {
        const s = get();
        const u = s.userPerfumes.find((x) => x.perfumeId === id);
        return {
          perfumeId: id,
          userPerfume: u ? { ...u } : null,
          day,
          wearEntry: s.wearLog.find((e) => e.d === day) ?? null,
          swapCount: s.swapCount,
          dustyAdoptCount: s.dustyAdoptCount,
          swapAways: s.swapAways,
        };
      },
      // 接受**一串**快照，而不是一个。
      //
      // 这条撤销存在的理由就是「想比三瓶用法」：点开三瓶看看怎么喷，三瓶就全被记成今天穿过。
      // 而此前 UI 只留最后一次的快照，撤销只回滚最后那一瓶——前两瓶的 wornCount、
      // lastWornAt 与隐式差评照样留着，轮换新鲜度与吃灰的 21 天计时也照样被重置。
      // 撤销掉一部分比不撤销更难解释。
      //
      // 全局项（香历当天那条、两个计数器、swapAways）取**最早**那张快照——它才是这一串
      // 浏览动作开始之前的现场；逐瓶项各自按 id 还原。
      undoAdopt: (snaps) =>
        set((s) => {
          const list = Array.isArray(snaps) ? snaps : [snaps];
          if (list.length === 0) return {};
          const first = list[0];
          const byId = new Map(list.map((x) => [x.perfumeId, x] as const));
          return {
            userPerfumes: s.userPerfumes.map((u) => byId.get(u.perfumeId)?.userPerfume ?? u),
            // 当天那条要么恢复成被覆盖前的样子，要么根本不该存在（这一串采纳才建的）
            wearLog: dedupeSortWear([
              ...s.wearLog.filter((e) => e.d !== first.day),
              ...(first.wearEntry ? [first.wearEntry] : []),
            ]),
            swapCount: first.swapCount,
            dustyAdoptCount: first.dustyAdoptCount,
            swapAways: first.swapAways,
          };
        }),
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
      // 用户亲手指定：origin 记 manual，从此自动定位不再覆盖它（清空则退回 none，下次打开重新问）
      setCity: (c) => set({ city: c, cityOrigin: c ? "manual" : "none" }),
      // 定位成功后反查到的城市。**不**升级成 manual：用户没有做过这个选择，
      // 下次打开仍要重新定位一次，否则出差/搬家之后会一直用旧城市的天气。
      setGeoCity: (c) => set({ city: c, cityOrigin: "geo" }),
      noteStorageWiped: () => {
        // ⚠️ 顺序不能反，与 onRehydrateStorage 的错误分支同理：下面这句 setState 会被
        // persist 立刻写回盘，不先冻结就等于自己把刚被抹掉的数据又写了回去。
        writesFrozen = true;
        set({ storageWiped: true });
      },
      setOccasion: (o) => set({ occasion: o, scene: null }), // 手动选场合即清除自然语言场景
      setScene: (s) => set({ scene: s }),
      hasPerfume: (id) => get().userPerfumes.some((u) => u.perfumeId === id),
      // 装载演示香柜。只在空柜且从未退出过演示时由 AppProvider 调用一次（见那里的守卫），
      // 这里再自查一遍：任何时候都不能盖掉用户自己的数据。
      enterDemo: (d) =>
        set((s) =>
          s.demoDismissed || hasOwnData(s as unknown as Record<string, unknown>)
            ? s
            : s.city
              ? demoPayload(d) // 已经有城市（用户填的或上次定位到的）就不碰它
              : // 演示城市**必须**带着来源一起写。只写 city 的旧写法让它和用户自己选的城市
                // 长得一模一样，于是它躲过了退场清理、也躲过了每次打开的定位申请。
                { ...demoPayload(d), city: d.city, cityOrigin: "demo" as CityOrigin }
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
      resetToDemo: (d) =>
        set(() => ({
          ...DEMO_CLEARED,
          ...demoPayload(d),
          city: d.city,
          cityOrigin: "demo" as CityOrigin,
          scene: null,
        })),
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
            version: EXPORT_VERSION,
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
        // 读盘失败时写入被冻结（保住盘上没读出来的字节）。用户导入了自己的备份，
        // 就意味着这台机器上该有什么已经由他说了算——解冻，从此正常落盘。
        writesFrozen = false;
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
            // 盘上的内容已经由这次导入重新定义，读盘失败那条警告到此为止
            hydrateError: null,
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
      hasRescueBackup: () => {
        try {
          return !!safeLocalStorage()?.getItem(BACKUP_KEY);
        } catch {
          return false;
        }
      },
      // 读盘失败时我们把原始字节另存到了 fencun-store.bak，但此前产品里没有任何入口去用它——
      // 字节还在，用户却无从取回，等于没有恢复路径。
      // 注意 .bak 存的是 persist 的包装形状 { state, version }，比导出文件多一层：
      // 直接喂 importData 会因为顶层没有 userPerfumes 而被判成"不是我们的备份"。
      restoreFromBackup: () => {
        let inner: unknown;
        try {
          const raw = safeLocalStorage()?.getItem(BACKUP_KEY);
          if (!raw) return false;
          const parsed = JSON.parse(raw) as { state?: unknown };
          inner = parsed && typeof parsed === "object" && "state" in parsed ? parsed.state : parsed;
        } catch {
          return false;
        }
        return get().importData(JSON.stringify(inner));
      },
    }),
    {
      name: STORE_KEY,
      // 服务端无 localStorage → 返回 undefined，persist 自动跳过；客户端正常持久化。
      //
      // ⚠️ setItem 必须自己接住异常，原因有两层：
      //   ① zustand 的 persist 把 set 包成「先改内存、再写盘」，两层包装都不 try/catch。
      //      写盘抛错时内存已经换掉 → UI 刷成"已生效"，盘上零字节，用户毫不知情。
      //      读盘失败那一半早就有 hydrateError + SiteNotice 这条告知通道了，
      //      写盘这一半一直没接上——这是设计缺口，不是取舍。
      //   ② 异常会从 onClick 里逃逸，打断事件处理器：`set()` 之后的语句一律不执行。
      //      实测两处可见后果——SearchAdd 的「+ 入柜」永久停在「取数据…」且 disabled；
      //      香柜的 8 秒撤销条根本不出现，删掉的瓶子连后悔入口都没有。
      //      React 的错误边界不接管事件处理器抛出的异常，app/error.tsx 也不会出现。
      // 所以这里吞掉异常并立起 persistError，由 SiteNotice 统一告知。
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") return undefined as unknown as Storage;
        const ls = safeLocalStorage();
        if (!ls) return undefined as unknown as Storage;
        return guardedStorage(
          ls,
          (e) => {
            // 只记第一次：配额满之后每一次写入都会抛，反复 setState 只会制造重渲染风暴
            if (!useStore.getState().persistError) useStore.setState({ persistError: String(e) });
          },
          () => !writesFrozen
        );
      }),
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
        cityOrigin: s.cityOrigin,
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
        // 判据是"这台机器上有没有属于他自己的东西"，不是"是不是老记录"——
        // 一律置 dismissed 会把「来过一次、柜子还空着」的人也挡在演示之外，
        // 而那恰恰是最该看到演示的人；反过来，留下过任何痕迹的人绝不能被装上别人的六瓶。
        // "痕迹"包含香历与反馈：柜清空了但香历还在，是产品自己承诺过的合法状态（见 hasOwnData）。
        if (from < 1) {
          s.demo = false;
          s.demoDismissed = hasOwnData(s);
        }
        // v1 → v2：新增 cityOrigin。盘上只有城市名，得把来源反推出来。
        //
        // 在 v1 里 city 只有两个写入点：情境栏的手填，和演示态自带的 DEMO_CITY。
        // 所以「不是北京」必然是手填的；「是北京」则绝大多数来自演示态——每一个首访者
        // 都经过演示香柜，而真正手填北京的是少数。把后者一并判成 demo 的代价，
        // 只是这些人下次打开会被问一次定位、然后自动定回北京，结果相同。
        if (from < 2) {
          const city = typeof s.city === "string" && s.city ? s.city : null;
          s.city = city;
          s.cityOrigin = city ? (city === DEMO_CITY ? "demo" : "manual") : "none";
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
            const raw = safeLocalStorage()?.getItem(STORE_KEY);
            if (raw) safeLocalStorage()?.setItem(BACKUP_KEY, raw);
          } catch {
            // 备份本身失败（存储被禁/配额满）也不能让流程卡住，错误标志仍要立起来
          }
          // ⚠️ 顺序不能反。下面这句 setState 会被 persist 立刻写回盘——
          // 不先冻结，止损代码自己就完成了它要阻止的那次覆盖（见 writesFrozen 的说明）。
          writesFrozen = true;
          useStore.setState({ hydrated: true, hydrateError: String(error) });
          return;
        }
        useStore.setState({ hydrated: true, hydrateError: null });
      },
    }
  )
);
