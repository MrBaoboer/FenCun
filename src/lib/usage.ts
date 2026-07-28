// 用法计算器（规则，产品壁垒层）—— 喷量/部位/距离/留香/风险，全程区间档位
import type { Perfume, Context, Usage, Bias } from "./types";
import { durationHint, SEASON_NAME } from "./format";
import { tempBand } from "./season";
import {
  sweetness,
  balsamicWeight,
  sweetDominates,
  balsamicDominates,
  heavyDominates,
  dataConfidence,
  weatherFit,
  WEATHER_CAUTION,
  type WeatherTone,
} from "./scoring";

// 场景的空间密度（影响喷量与风险）
const DENSITY: Record<string, "dense" | "closed" | "normal" | "open"> = {
  commute: "dense",
  work: "closed",
  formal: "closed",
  date: "normal",
  social: "normal",
  casual: "normal",
  home: "open",
  sport: "open",
};

function accStrength(p: Perfume, en: string): number {
  const a = p.accords.find((x) => x.en === en);
  return a ? a.strength : 0;
}

// 「用力过猛」组合：甜重/浓白花 × 强扩散 × 通勤会议类场合——国内语境下最容易被负面评价的搭配
//
// 甜这一侧走主导度判据（与高温减量、发腻文案同一条口径）：绝对线 ≥50 会把爱神烈焰
//（citrus=100、sweet 只是第 N 位的 58）也判成"甜和扩散都偏高"，而这句话紧接着就要
// 把喷量压到 1 下、把位置放到腰侧——对一瓶柑橘当家的香，三样都是错的。
//
// 白花这一侧**刻意仍用绝对线**：白花与"floral"共用一个家族，花之炸弹的首位就是 floral=100、
// white floral=56，拿后者去除前者得到的 0.56 衡量的是"标签粒度"而不是"这瓶浓不浓白花"。
// 同一个修法换个地方就不成立——宁可这一侧保守，也不要把一个成立的判据用到它不成立的地方。
function overdressedCombo(p: Perfume, ctx: Context): boolean {
  const loudSweet = sweetDominates(p, 50);
  const loudFloral = accStrength(p, "white floral") >= 50;
  const officeish = ctx.occasion === "commute" || ctx.occasion === "work" || ctx.occasion === "formal";
  return (loudSweet || loudFloral) && p.sillageTier >= 3 && officeish;
}

export function computeUsage(p: Perfume, ctx: Context, bias?: Bias): Usage {
  // 无香场合先于一切规则返回：就医、探病、体检、陪诊。
  // 这是全引擎唯一一条建议"不用"的规则，也是依据最好的一条——
  // 约三分之一人群报告对香味制品有不良反应，多国医疗机构对访客有明确无香要求。
  // 放在最前面是有意的：任何个人偏好、成功配置、场合加成都不该把它覆盖掉。
  // （format.ts 的 DISTANCE_HINT[1] 因此不把"就医"列为贴肤香的适用场合——
  // 就医场合的答案是"今天不用"，不是"选贴肤的"。）
  if (ctx.fragranceFree) {
    return {
      sprays: [0, 0],
      spraysLabel: "今天不用",
      placement: [],
      socialDistance: 1,
      // note 与 risks[0] 分工：risks[0] 说"为什么"（进解读位），note 说"那怎么办"（进分寸位）。
      // 两处措辞必须互补，不能是同一句话的两种说法——同屏重复会显得系统在凑字数。
      durationHint: "留到下一次。它不会因为今天不用就跑掉",
      suitable: false,
      note: "今天把它留在家里。出门前洗过手、换件没沾过香的外套，就是这个场合最好的分寸。",
    };
  }
  const sil = p.sillage ?? 2.5;
  // 喷量基础档：扩散越强，喷越少
  let lo: number, hi: number;
  if (sil >= 3.2) [lo, hi] = [1, 2];
  else if (sil >= 2.4) [lo, hi] = [2, 3];
  else [lo, hi] = [3, 4];

  // 安全阀是否真的压过这瓶——决定个人偏好还能不能往上抬（见下方 safetyCap 那段）
  let capped = false;

  const density = DENSITY[ctx.occasion] ?? "normal";
  if (density === "dense" || density === "closed") {
    lo = Math.max(1, lo - 1);
    hi = Math.max(lo, hi - 1);
    capped = true;
  } else if (density === "open" && ctx.occasion === "sport") {
    // 运动留香易散，但不鼓励多喷，维持
  }
  // 冷天清淡香可略增；高温下强扩散香压一档。
  // 【方向来自证据，量级是保守默认】高温防护此前只挂在 hot_humid 上，是把"湿"当成了主变量。
  // 真正的主变量是温度：干热同样让香水在皮肤上爆得更快。湿热多出来的是热舒适度惩罚
  //（汗液蒸发受阻，同样的浓度更容易越过"过头"线），不是额外的挥发惩罚——
  // 事实上干热下蒸发散热有效，皮温往往还低于同气温的湿热。所以两者都保护，不再厚此薄彼。
  const hotFeel = ctx.feel === "hot_humid" || ctx.feel === "hot_dry";
  if (ctx.feel === "cold" && sil < 2.4) hi = Math.min(hi + 1, 5);
  // 高温减量有两条触发：扩散本身强，或这瓶**由**甜/树脂主导（computeRisks 会为后者写出
  // 「高温里存在感会比你以为的更强，喷得收着些更稳」）。第二条是为了让**已经说出口的那句话兑现**——
  // 此前只认 sillage≥3.2，于是蔚蓝浓香精(sil=2.17, amber=86) 在 33℃ 会一边被提醒"收着些"、
  // 一边拿到 3–4 下的最高档，文案与数字互相打脸。
  //
  // ⚠️ 这里必须与 computeRisks 用**同一个**判据，不能各用一条绝对线。
  // 上一版两边都写 `max(sweet, balsam) >= 55`，看着一致，实则和打分层（scoring.ts 早已换成
  // 主导度判据）分了家：旷野(fresh spicy=100, balsamic=59) 在 33℃ 会被同一张卡先夸
  // "调性清爽通透"、再罚"树脂琥珀感偏厚"，喷量还跟着少一下。主目录实测 793 → 567 款，
  // 少掉的 226 款正是清爽当家的那批。同一个概念只准有一处判据。
  //
  // 上一版换成 richDominates(55) 之后仍然差半步：风险文案的三支合起来是
  // sweetDominates(55) ∪ balsamicDominates(55) ∪ heavyDominates(50)，而前两者都被
  // heavyDominates(50) 包住（族更宽、绝对线更低、主导度门槛同一条），也就是说
  // **文案的口径其实就是 heavyDominates(50)**，减量却停在 richDominates(55)。
  // 差出来的正是烟草与动物性主导的那一批：卡上写着「厚重感在高温里会放大，
  // 喷得收着些更稳」，喷量却纹丝不动地给到最高档。取并集不如直接认那个更宽的口径。
  // 【天气驱动的减量总计封顶 1 下】——两条同时命中也只减一次，避免叠加过度。
  if (hotFeel && (sil >= 3.2 || heavyDominates(p, 50))) {
    hi = Math.max(lo, hi - 1);
    capped = true;
  }
  // 餐桌场合：气味干扰味觉，收一档
  if (ctx.meal) {
    hi = Math.max(lo, hi - 1);
    capped = true;
  }
  // 高张力场合（前任婚礼 / 谈判 / 见家长）：目标是"不被记住是因为香水"，一律再收一档
  if (ctx.tension === "high") {
    hi = Math.max(lo, hi - 1);
    capped = true;
  }
  if (ctx.avoid?.includes("too_strong")) {
    lo = Math.max(1, lo - 1);
    hi = Math.max(lo, hi - 1);
    capped = true;
  }
  // 甜重/浓白花 × 强扩散 × 通勤会议：容易显得用力过猛，压到 1 下（与风险文案一致）
  if (overdressedCombo(p, ctx)) {
    lo = 1;
    hi = 1;
    capped = true;
  }
  lo = Math.max(1, Math.min(lo, hi));
  hi = Math.max(lo, hi);

  // ── 安全上限在这里定死 ──────────────────────────────────────────────
  // 到这里为止的 hi 是"这个场合 × 这个天气 × 这瓶香，最多能喷几下"。
  // 它由封闭空间、餐桌、高张力、闷热、用力过猛组合这几道**安全阀**共同压出来，与个人偏好无关。
  //
  // ⚠️ 这一行的位置就是它的全部意义。原先它在个人偏好之后取值，于是偏好把闸抬起来之后，
  // 抬起来的那个值反过来成了"安全上限"——闸门自己被它要防的东西顶开了。
  // 实测（烟草香草 / 通勤 / 20℃，overdressedCombo 三条全中，风险文案写着「压到 1 下」）：
  //   纯净 = 1 下 · 场景写了「想被注意到」= 1–2 下 · 历史两次「淡了点」= 1–2 下 · 两者叠加 = 1–3 下
  // 同一张卡上「压到 1 下」和「1–3 下」并排出现。手册把礼仪/公共卫生取向的规则列为 A 类，
  // 个人偏好是 B 类，B 类不该覆盖 A 类。
  //
  // ⚠️ 但"上限"和"基准"不是同一个数。上一版把这一行的取值直接当成天花板，于是
  // 一条安全阀都没命中时（居家、休闲、温和天气），偏好空间被压成**单向**——
  // 下方两条 `hi + 1` 全部被 122 行的钳制无条件撤销，是死代码。
  // 代价是两句对用户说出口的话永久落空：反馈条明写「记下了，下次帮你略微多喷一点」，
  // 而引擎永远不会多喷；场景解析出的 intimacy="broadcast"（"今晚想被注意到"）
  // 在全仓只有这一个消费点，于是那句话不改变任何一个数字。
  // 四个反馈按钮里有一个是纯表演，而反馈闭环是这个产品唯一的真壁垒。
  const safetyCap = hi;
  // 偏好总计只能抬一档——与本文件既有的【天气驱动的减量总计封顶 1 下】同一条纪律：
  // 「略微多喷一点」和「想被注意到」各自都是"略"，叠加起来不该变成两档。
  const prefCeiling = capped ? safetyCap : Math.min(safetyCap + 1, 5);

  // ── 成功配置：它是**基准**，不是终点 ────────────────────────────────
  // 同温度档 × 同场合你反馈过「刚好」→ 从那次的量起算，但只能在安全上限之内复用：
  //「上次刚好」记的是上次的场合，覆盖不了今天更封闭的会议室、更闷的天、
  // 或这瓶香本身的用力过猛组合。个性化不能凌驾于安全阀之上。
  //
  // ⚠️ 它此前写在偏好**之后**，且是 `lo = hi = applied` 的无条件覆盖，于是只夹住了安全阀、
  // 把更近的信号一并抹掉：一条旧的「刚好 4 下」会盖过随后两次「太冲了」，
  // 也盖过场景解析出的「今晚想贴身一点」。而反馈闭环恰恰是这个产品唯一的真壁垒——
  // 让最新的反馈失效，比不做这个功能更糟。
  // 顺序改成「安全阀 → 记忆的基准 → 当下的偏好 → 收口」，四层各司其职。
  const cfg = bias?.successConfigs?.find(
    (c) => c.occasion === ctx.occasion && c.tempBand === tempBand(ctx.tempC)
  );
  const remembered = cfg ? Math.max(1, Math.min(5, cfg.sprays)) : null;
  if (remembered != null) lo = hi = Math.max(1, Math.min(remembered, safetyCap));

  // ── 个人偏好：可升可降，但一律不得越过 safetyCap ────────────────────
  // 自然语言场景：想贴身则收一档、想被注意到可略增
  if (ctx.intimacy === "close") hi = Math.max(1, hi - 1);
  if (ctx.intimacy === "broadcast") hi = Math.min(hi + 1, 5);
  // 反馈闭环：你多次觉得"太冲"(perceivedStrength>0)→少喷；"太淡"(<0)→多喷。兑现"下次帮你少喷半下"
  const ps = bias?.perceivedStrength ?? 0;
  if (ps >= 0.4) {
    hi = Math.max(1, hi - 1);
    if (ps >= 0.7) lo = Math.max(1, lo - 1);
  } else if (ps <= -0.4) {
    hi = Math.min(hi + 1, 5);
  }
  // 收口：安全阀压过就一步都不许抬，没压过也最多抬一档；
  // 同时任何路径都不允许出现 "2–1 下" 这种反向区间
  hi = Math.min(hi, prefCeiling);
  lo = Math.max(1, Math.min(lo, hi));

  // 成功配置的回执：说的必须是**最终这个数**是怎么来的，不能停在"按那次的量来"——
  // 上面已经允许更近的反馈与场景把它推开了，回执跟不上就又变成一句不兑现的话。
  let note: string | undefined;
  if (remembered != null) {
    note =
      hi < remembered
        ? ps >= 0.4
          ? "上次同样天气、同样场合你说「刚好」——不过你后来又说过它偏冲，这次在那个量上再收一点。"
          : "上次同样天气、同样场合你说「刚好」——不过今天这个场合更收着些，先按更少的量来。"
        : hi > remembered
          ? "上次同样天气、同样场合你说「刚好」——今天在那个量上略放开一点。"
          : "上次同样天气、同样场合你说「刚好」——就按那次的量来。";
  }

  const spraysLabel = lo === hi ? `${lo} 下` : `${lo}–${hi} 下`;

  // 喷洒位置 —— 本质是一个**投射档位盘**，比"少喷一下"更精细：
  //   颈侧 / 胸口（靠近呼吸带、离对话者近，投射最强）
  //     > 手腕（居中）
  //     > 耳后 / 衣物内侧（皮温最低、织物又是惰性基质，输出最弱）
  // 它能只收敛别人闻到的强度，而不牺牲你自己闻到的体验。
  //
  // 这里必须纠正一个流传极广、但**没有同行评议依据**的说法：「脉搏点血流丰富所以温度更高、
  // 更能激发香气」。实测的人体分区皮温不支持它——颈前是全身最热的区域之一（约 35℃），
  // 而"经典脉搏点"里的耳部（约 30℃）反倒是最冷的区域之一，区域跨度约 5℃。
  //
  // ⚠️ 三条使用这批数据时必须记住的限制（否则会重蹈"拿论文背书"的覆辙）：
  //   1. 该实测是**单一室温条件**（约 24℃、静息）下的横截面测量，**没有操纵过气温**——
  //      它能说明"部位之间有差异"，不能说明"气温变化时各部位怎么变"；
  //   2. **手腕从未被单独测量**。常被引用的 32.6℃ 是**前臂**的读数，两者不是一回事；
  //   3. 手腕是**肢端**部位，受交感性血管舒缩强烈调制，个体间腕温差可达 2.9℃——
  //      也就是说手腕是全身**最不可预测**的落点。任何基于手腕皮温的精细推理都不该做。
  // 因此注释与文案里都不写带小数的皮温值：两次独立核查对颈部给出的读数就不一致。
  let placement: string[];
  if (ctx.intimacy === "close") placement = ["颈侧贴身", "手腕"];
  else if (density === "closed" || density === "dense") placement = ["手腕", "衣物内侧"];
  else if (ctx.occasion === "date") placement = ["颈侧", "手腕"];
  else if (ctx.occasion === "social") placement = ["颈侧", "胸口"];
  else placement = ["颈侧", "手腕"];
  // 头发确实是比皮肤更好的香气载体，但它位于呼吸带高度、随头部运动持续搅动空气、比表面积又大，
  // 是**投射最不可控**的落点。所以只在约会、且这瓶本身不外放时才给，并且改成一个可执行的动作——
  // 「发梢少量」是用户无法执行的指令（少量是多少？），喷梳子再梳过去是同等效果、几乎零风险的替代。
  // 高温时整条去掉，理由是出汗与投射失控，**不是"酒精伤发"**——那句是没有依据的美妆口头禅。
  if (ctx.occasion === "date" && sil < 2.8 && !hotFeel) {
    placement.push("发尾（喷在梳子上，再梳过去）");
  }
  if (hotFeel) {
    placement = placement
      .map((x) =>
        x === "手腕"
          ? "衣物内侧"
          : x === "颈侧" || x === "颈侧贴身"
          ? "耳后 / 衣领内侧"
          : x === "胸口"
          ? "衣物内侧"
          : x
      )
      .filter((x) => !x.includes("发") && !x.includes("梳"));
    placement = Array.from(new Set(placement));
    if (placement.length === 0) placement = ["衣物内侧"];
  }
  // 用力过猛组合：位置整体放低——热空气自下而上，浓香从腰以下缓释才体面【行业惯例，非物理】
  if (overdressedCombo(p, ctx)) placement = ["腰侧", "衣物下摆内侧"];

  // 社交距离取「喷后有效档」而非原始扩散：已生效的减档（封闭/贴身/嫌冲/闷热压量）都会降低实际投射，
  // 封顶降 2 档，避免同屏出现「喷 1 下」却仍标「整间屋都是它」的自相矛盾。
  let distReduce = 0;
  if (density === "dense" || density === "closed") distReduce++;
  if (ctx.intimacy === "close") distReduce++;
  if (ctx.avoid?.includes("too_strong")) distReduce++;
  if (ps >= 0.4) distReduce++;
  const effTier = Math.max(1, p.sillageTier - Math.min(distReduce, 2)) as 1 | 2 | 3 | 4;

  // suitable 问的是「这一瓶今天合不合适」，所以与 computeVerdict 同口径：只看本瓶风险。
  // 场景提示对柜里每一瓶都成立，算进来会让全柜同时变成"不合适"（见 isBottleRisk）。
  const bottleRisks = computeRiskNotes(p, ctx).filter(isBottleRisk);

  // 留香提示：在场时间不短 + 这瓶偏短效 → 提醒带分装（时长来自场景解析的档位值，不精确到小时）
  let dHint = durationHint(p.longevity);
  if ((ctx.duration ?? 0) >= 6 && (p.longevity ?? 3) < 3) {
    dHint += "；在外时间不短，带上分装中途补 1 下更稳";
  }

  return {
    sprays: [lo, hi],
    spraysLabel,
    placement,
    socialDistance: effTier,
    durationHint: dHint,
    suitable: bottleRisks.length === 0,
    note,
  };
}

/**
 * 每一条风险都带着它的成因走。
 *
 * 成因是**受控字段**，不是从中文里认出来的——这是 scoring.ts:WeatherTone 立下、
 * recommend.ts:avoidCause 贯彻过一次的同一条纪律，这里把它落到最后一段：
 * 预警卡的眉标按 avoidCause 分岔（「季节不对」/「今天的体感」/「场合偏封闭」），
 * 正文却一直在取 risks[0]，而 risks 的追加顺序（封闭 → 高温 → 餐桌 → 用力过猛 →
 * 反季 → 高张力 → 场景）与成因优先级（天气 > 反季 > 场地）毫无关系。
 * 只要同时命中一条更靠前的风险，眉标与正文就说的不是同一件事——
 * 而这张卡就印在 README 首屏那张图上。
 *
 * 靠中文子串去认（`r.includes("反季")`）能修好今天，但会把归因的正确性
 * 绑死在措辞不许改上，下一次润色文案就重新错开。所以带标走。
 */
export type RiskKind = "venue" | "weather" | "meal" | "overdressed" | "season" | "tension" | "scene";
export interface RiskNote {
  kind: RiskKind;
  text: string;
}

/**
 * 这一条说的是**这一瓶**，还是**今天这个场合**？
 *
 * scene 一档（来自 ctx.riskNote，即 LLM 从用户原话里读出的场合常识，以及无香场合那一句）
 * 对柜里每一瓶都成立，因此它**不具备区分力**，不能参与"这瓶今天行不行"的裁决。
 * 混进去的后果是可测的：computeVerdict 的规则是 risks.length > 0 → caution，
 * 于是只要场景解析返回了任何一句 riskNote，全目录 1500 款的裁决实测塌成
 * caution 1209 / avoid 291 / **good 0**——而 good 正是三处闸门的通行证：
 * nudges 的吃灰卡（verdict==="good"）、预警卡的「换成 X」（同上）、以及 usage.suitable。
 * 也就是说，用户一旦用起产品的旗舰能力（自然语言场景），发现型钩子就整体哑火。
 *
 * 这与「织物留印提示被 computeVerdict 吃掉」是同一个坑换了个门：
 * **提示与风险必须分清，混用会污染裁决。** 上次是靠调整调用顺序绕过去的，
 * 这次把它变成一条带类型的、任何调用方都绕不过的判据。
 * 场景提示照常上屏（它对用户有用），只是不再参与裁决。
 */
export const isBottleRisk = (n: RiskNote): boolean => n.kind !== "scene";

/** 只要文本的调用方走这里；需要按成因取某一条的走 computeRiskNotes */
export function computeRisks(p: Perfume, ctx: Context): string[] {
  return computeRiskNotes(p, ctx).map((r) => r.text);
}

export function computeRiskNotes(p: Perfume, ctx: Context): RiskNote[] {
  const risks: RiskNote[] = [];
  const push = (kind: RiskKind, text: string) => risks.push({ kind, text });
  // 无香场合：只说这一条，不要再堆别的风险——用户此刻只需要一个结论
  if (ctx.fragranceFree) {
    return [
      {
        kind: "scene",
        text: "医院、诊所这类场合，很多人对气味格外敏感，而他们没有回避的余地——今天把香水留在家里最稳妥。",
      },
    ];
  }
  const density = DENSITY[ctx.occasion] ?? "normal";

  if (p.sillageTier >= 4 && (density === "closed" || density === "dense")) {
    push("venue", "空间偏封闭、人也多，这瓶气场较大——建议只喷 1 下，或换一瓶更贴肤的。");
  }
  // 甜与琥珀是两回事，风险也是两回事：
  // 甜（美食调）在湿热里会"发腻"；树脂香膏（琥珀/香膏/沉香）会"闷、不透气"——但它不甜。
  // 旧代码 max(sweet, amber, vanilla) 把两者混成一个数，让 112 款主目录香
  // （蔚蓝浓香精 amber=86/sweet=0、旷野、当蓝、绿爱尔兰花呢…）被告知"它偏甜重、容易发腻"。
  // 拆桶的已知代价，写在这里而不是假装不存在：
  // 数据层**无法**区分干性琥珀与甜东方琥珀——Fragrantica 的 accord 词表里没有
  // ambergris / ambroxan，Ambroxan 主导的现代干琥珀只能落到 amber(+woody)，
  // 与劳丹脂+安息香+香草醛构建的经典甜琥珀共用同一个标签。
  // 所以这里只能做粗粒度处理：amber 一律不计入"甜/发腻"。
  // 代价是像 Shalimar、Ambre Nuit 这类甜味主要由 amber accord 承载、而 sweet 标签可能 <55 的经典东方香，
  // 会**漏报**发腻风险。这是刻意接受的偏向：宁可漏报，也不要对 112 款一点不甜的香误报。
  // （也不要把干琥珀说成"完全不甜"——它是矿物木质框架上的微甜，只是不产生美食调那种累积性的腻。）
  //
  // 拆桶之外还有第二道：**这一族得主导这瓶，才配代表它的气质**（sweetDominates / balsamicDominates）。
  // 只看绝对线的代价与 amber 混进甜桶是同一类，只是藏在文案里：主目录实测 634 款过甜的绝对线，
  // 其中 187 款的甜只是第 N 位的一点尾调——信仰之水(fruity=100, sweet=55)、博柏利她、
  // 邂逅柔情都会被告知"甜感偏重、上身久了容易发腻"；树脂那侧同理，旷野(fresh spicy=100,
  // balsamic=59)、探索家、绿爱尔兰花呢会被判"树脂琥珀感偏厚"。而同一张卡的"为什么"里，
  // 打分层（早就用了主导度判据）正写着"调性清爽通透，正合今天的天气"。
  // 这两句必须由同一条判据产出，否则卡片自己打自己。
  const sweet = sweetness(p);
  const balsam = balsamicWeight(p);
  const hot = ctx.feel === "hot_humid" || ctx.feel === "hot_dry";
  // 天气把这瓶压到「要留意」那一档时，这里就**必须**说得出为什么。
  //
  // 裁决有两个触发源：risks 非空，以及 parts.weather < WEATHER_CAUTION。第二个此前没有
  // 任何文案与之配对，代价是可测的——全目录 × 温湿度 × 场合扫一遍，12.6% 的 caution
  // 配的是一张空清单：卡上挂着「有一点要留意」，下面一条都没有。
  // 其中冷侧（thin_in_cold）从来就没有过对应文案；热侧那批则落在 22–28℃ 这段
  // ——weatherFit 的热负荷从 22℃ 起算，而 ctx.feel 要更高才算 hot，两条线本来就不齐。
  //
  // 措辞仍然只由 tone 决定（本文件既有的纪律），门槛与裁决共用同一个常量。
  const wf = weatherFit(p, ctx.feel, ctx.tempC, ctx.humidity);
  const weatherDrivesCaution = wf.w < WEATHER_CAUTION;
  if (hot || (weatherDrivesCaution && wf.tone === "heavy_in_heat")) {
    const weatherWord = ctx.feel === "hot_humid" ? "又热又潮" : hot ? "这么热" : "气温偏高";
    if (sweetDominates(p, 55)) {
      push("weather", `今天${weatherWord}，它的甜感偏重，上身久了容易发腻，可考虑换清爽些的。`);
    } else if (balsamicDominates(p, 55)) {
      push("weather", `今天${weatherWord}，它的树脂琥珀感偏厚，高温里存在感会比你以为的更强，喷得收着些更稳。`);
    } else if (heavyDominates(p, 50)) {
      // 打分层的「厚重」比甜/树脂两族多出动物性与烟草——它们在高温里同样变闷，只是不甜也不树脂。
      // 少了这一支，一瓶烟草主导的香会被打分层判 heavy_in_heat、被裁决层判「今天不建议」，
      // 却一条风险都说不出来：正是「判了却说不出为什么」那类结构性缺陷。
      push("weather", `今天${weatherWord}，它的厚重感在高温里会放大，存在感比你以为的更强，喷得收着些更稳。`);
    }
  }
  // 冷侧此前一句都没有。它不是"会过头"，而是**留不住**——措辞要对得上归因，
  // 也不能顺口许一个引擎不会兑现的动作：喷量的冷天加成只给扩散弱的那一档
  //（见本文件上方 `ctx.feel === "cold" && sil < 2.4`），所以这里不说"多喷一点"。
  if (weatherDrivesCaution && wf.tone === "thin_in_cold" && !risks.some((r) => r.kind === "weather")) {
    push("weather", "今天偏冷，它这类清冽调容易发飘、留不住——别指望它陪一整天，想要更立得住就换一瓶更暖的。");
  }
  // 餐桌场合：浓香/甜香和食物气味打架（高端餐饮甚至明示谢绝浓香）
  if (ctx.meal && (Math.max(sweet, balsam) >= 55 || p.sillageTier >= 3)) {
    push("meal", "这顿饭是场合的一部分——它的存在感会和食物气味打架，喷得比平时更收着些。");
  }
  // 「用力过猛」组合提示（国内语境：办公室里的浓甜白花有"柜姐感"联想）
  if (overdressedCombo(p, ctx)) {
    push("overdressed", "甜和扩散都偏高，这类场合容易显得用力过猛——压到 1 下、放低位置会体面很多。");
  }
  // 季节错配：相对差，不用绝对阈值。
  // **必须过和 buildReasons 同一道票数门槛**——「大家更多在冬季用它」是一句关于社区数据的断言，
  // 没有足够的票就没有资格说。手动记录的香因 seasonPct 恒为 0.25×4、差值恒 0 而侥幸不触发；
  // 但低票扩展集（三五票的噪声分布）会触发，于是拿三票去对用户说"大家更多在…"。
  // 这与 buildReasons 里那条「社区投票里它更偏◯季」是同一类编造，只是藏在风险文案里晚了一步被发现。
  if (!p.custom && !p.lowVotes && dataConfidence(p) >= 0.75) {
    const entries = Object.entries(p.seasonPct) as [keyof typeof p.seasonPct, number][];
    const best = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
    const cur = p.seasonPct[ctx.season];
    if (best[0] !== ctx.season && best[1] - cur >= 0.12) {
      const map: Record<string, string> = { winter: "冬", spring: "春", summer: "夏", autumn: "秋" };
      push("season", `大家更多在${map[best[0]]}季用它，今天用会有点反季。`);
    }
  }
  // 高张力场合 × 存在感偏强：规则层自己就要说这句，不能只指望场景解析恰好返回 riskNote
  if (ctx.tension === "high" && p.sillageTier >= 3) {
    push("tension", "这种场合，最好别让香水成为被讨论的那件事——它的存在感偏强，压到最低量、只留贴身的一点更稳妥。");
  }
  // 场景解析给出的社交风险（LLM 的场景常识以受控字段进入，不允许它自由发挥进正文）
  if (ctx.riskNote && !risks.some((r) => r.text.includes(ctx.riskNote!))) {
    push("scene", ctx.riskNote.endsWith("。") ? ctx.riskNote : ctx.riskNote + "。");
  }
  return risks;
}

// 天气归因 → 人话。**只能由 tone 决定措辞**，绝不由 W 的数值反推：
// 数值只说"占了便宜"，说不出"因为什么占便宜"，而这两者在冷天暖调上恰好相反。
const WEATHER_PHRASE: Record<WeatherTone, (topAccords: string) => string | null> = {
  fresh_in_heat: (a) => `${a}的调性清爽通透，正合今天的天气`,
  warm_in_cold: (a) => `${a}的暖意，在今天这个温度里更立得住`,
  heavy_in_heat: () => `它偏厚重，今天的体感里要留意会不会闷`,
  thin_in_cold: () => `今天偏冷，它这类清冽调容易发飘、留不住`,
  neutral: () => null,
};

// 规则生成的"为什么"要点 —— 同时作为 DeepSeek 解释不可用时的兜底。
// 这些句子会以"事实"的身份进入 /api/explain，所以每一句都必须真的成立：
// 不知道的不说，没有社区数据的不许提"社区投票"。
export function buildReasons(
  p: Perfume,
  ctx: Context,
  parts: { season: number; weather: number; weatherTone: WeatherTone; occasion: number; confidence: number }
): string[] {
  // 无香场合：结论是"今天别用"，就不该再罗列它今天多合适。
  // 「正是它的主场季」「正合今天的天气」与「今天把它留在家里」同屏出现，
  // 和「今天不建议用它」下面挂着「喷 2 下」是同一种自相矛盾。
  if (ctx.fragranceFree) return [];
  const r: string[] = [];
  const topAccords = p.accords.slice(0, 3).map((a) => a.zh).join("·");
  // 「社区投票里…」是一句关于数据的断言：没有足够的票就没有资格说。
  // 手动记录的香 seasonPct 是我们填的 0.25×4，低票扩展集则是三五票的噪声——
  // 拿这两种"数据"去说"社区投票里它更偏冬季"，是纯粹的编造，直接违反反伪精确红线。
  if (parts.season >= 0.85 && parts.confidence >= 0.75 && !p.custom && !p.lowVotes) {
    r.push(`正是它的主场季——社区投票里它更偏${SEASON_NAME[ctx.season]}`);
  }
  // 降级情境（拒绝定位 / 接口失败）下**一个字都不许提天气**。
  // 那时 tempC 是我们按季节填的代表值（夏 27℃ / 冬 6℃，见 hooks.ts:useResolvedContext），
  // 天气乘子照常算出来，于是模板会写出「正合今天的天气」「在今天这个温度里更立得住」——
  // 而同一屏的顶部横幅正写着「还没拿到天气，先按季节 · 时段为你推荐」。
  // 实测降级情境各 200 组随机香柜：夏 92%、冬 88.5% 的解读里出现了这类断言。
  // hooks.ts:61 自己写下的不变式是"不冒充的是实时天气"——预警和 LLM 都关掉了，这条模板出口漏了。
  //
  // 降级时我们确实知道季节，所以不是闭嘴，而是**只说知道的那部分**：
  // 季节主场那一句照常给（它由 seasonPct 得出，与天气无关），天气这一句整条跳过。
  if (!ctx.approximate) {
    const wp = WEATHER_PHRASE[parts.weatherTone](topAccords);
    if (wp) r.push(wp);
  }
  if (parts.occasion >= 0.8) r.push(`风格（${p.styleTags.join("·")}）贴合${ctx.occasion === "date" ? "约会" : "今天的场合"}`);
  if (p.custom) r.push(`这瓶是你手动记录的，按所选香调的典型情况估计，用两次并反馈后会更准`);
  else if (p.lowVotes) r.push(`这瓶的社区数据还少，判断偏保守，你的反馈会让它更准`);
  if (r.length === 0) r.push(`${topAccords}的整体气质，和今天比较合拍`);
  return r;
}
