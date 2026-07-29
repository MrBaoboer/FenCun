// 备份文件的校验层。**单独一个模块，只为让 zod 离开首屏包**。
//
// zod 此前从 store.ts 顶层 import 进来，于是它整个进了客户端共享 chunk：差分构建实测
// （把 store 的 zod 换成同 API 的空壳、其余一字不动、重跑 next build、逐页累加
// 预渲染 HTML 里的 <script>）四页各省 276.9KB raw / 62.8KB gzip，占首页 JS 的 26%。
// 而它在客户端只有两个消费点——「我的 · 导入备份」里用户点一下才走的 previewImport
// 与 importData。每个首访者在拿到第一条推荐之前都要为一个绝大多数会话不会触发的动作
// 多下 63KB、多编译 277KB。
//
// 所以校验搬到这里，由 store 在需要时 `await import()`。代价是那两个 action 变成异步——
// 调用方本来就在等 FileReader，这一步不增加任何用户可感的等待。
import { z } from "zod";
import type { Feedback, Occasion, Perfume, UserPerfume, WearEntry } from "./types";

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

/** 逐条校验，坏的丢掉而不是整包拒收（宽进严出） */
function keepValid<T>(items: unknown[] | undefined, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(items)) return [];
  const out: T[] = [];
  for (const it of items) {
    const r = schema.safeParse(it);
    if (r.success) out.push(r.data);
  }
  return out;
}

/** 校验并归一之后的备份内容。undefined 表示"这份备份没写这一项，保留现状" */
export interface ParsedBackup {
  userPerfumes: UserPerfume[];
  feedbacks: Feedback[];
  extPerfumes: Perfume[];
  customPerfumes: Perfume[];
  swapAways: Record<string, number[]>;
  wearLog: WearEntry[];
  city?: string;
  occasion?: Occasion;
  swapCount?: number;
  dustyAdoptCount?: number;
}

/**
 * 解析一份备份文件。返回 null = 这不是我们的备份，调用方一个字节都不许动。
 *
 * 校验全部前置在这里，是为了让 store 那边的 set 之后不再有任何可能失败的判断——
 * 「返回 false 只能意味着状态一个字节都没动」这句承诺靠的就是这个顺序。
 */
export function parseBackup(raw: string): ParsedBackup | null {
  let d: z.infer<typeof ImportSchema>;
  try {
    const parsed = ImportSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    d = parsed.data;
  } catch {
    return null;
  }
  const userPerfumes = keepValid(d.userPerfumes, UserPerfumeSchema);
  // 一条都没活下来而原始数组非空 = 不是我们的备份
  if (userPerfumes.length === 0 && d.userPerfumes.length > 0) return null;
  return {
    userPerfumes,
    feedbacks: keepValid(d.feedbacks, FeedbackSchema).slice(-400) as Feedback[],
    extPerfumes: keepValid(d.extPerfumes, PerfumeSnapshotSchema) as unknown as Perfume[],
    customPerfumes: keepValid(d.customPerfumes, PerfumeSnapshotSchema) as unknown as Perfume[],
    swapAways: d.swapAways ?? {},
    wearLog: keepValid(d.wearLog, WearEntrySchema) as WearEntry[],
    city: typeof d.city === "string" ? d.city : undefined,
    occasion: OCCASIONS.includes(d.occasion as Occasion) ? (d.occasion as Occasion) : undefined,
    swapCount: typeof d.swapCount === "number" ? d.swapCount : undefined,
    dustyAdoptCount: typeof d.dustyAdoptCount === "number" ? d.dustyAdoptCount : undefined,
  };
}
