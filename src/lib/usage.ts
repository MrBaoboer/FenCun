// 用法计算器（规则，产品壁垒层）—— 喷量/部位/距离/留香/风险，全程区间档位
import type { Perfume, Context, Usage, Bias } from "./types";
import { durationHint, SEASON_NAME } from "./format";
import { tempBand } from "./season";
import { sweetness, balsamicWeight, dataConfidence, type WeatherTone } from "./scoring";

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
function overdressedCombo(p: Perfume, ctx: Context): boolean {
  const loudSweet = sweetness(p) >= 50;
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

  const density = DENSITY[ctx.occasion] ?? "normal";
  if (density === "dense" || density === "closed") {
    lo = Math.max(1, lo - 1);
    hi = Math.max(lo, hi - 1);
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
  // 高温减量有两条触发：扩散本身强，或这瓶偏甜/偏树脂（computeRisks 会为后者写出
  // 「高温里存在感会比你以为的更强，喷得收着些更稳」）。第二条是为了让**已经说出口的那句话兑现**——
  // 此前只认 sillage≥3.2，于是蔚蓝浓香精(sil=2.17, amber=86) 在 33℃ 会一边被提醒"收着些"、
  // 一边拿到 3–4 下的最高档，文案与数字互相打脸。
  // 【天气驱动的减量总计封顶 1 下】——两条同时命中也只减一次，避免叠加过度。
  if (hotFeel && (sil >= 3.2 || Math.max(sweetness(p), balsamicWeight(p)) >= 55)) {
    hi = Math.max(lo, hi - 1);
  }
  // 餐桌场合：气味干扰味觉，收一档
  if (ctx.meal) hi = Math.max(lo, hi - 1);
  // 甜重/浓白花 × 强扩散 × 通勤会议：容易显得用力过猛，压到 1 下（与风险文案一致）
  if (overdressedCombo(p, ctx)) {
    lo = 1;
    hi = 1;
  }
  // 自然语言场景：想贴身则收一档、想被注意到可略增
  if (ctx.intimacy === "close") hi = Math.max(lo, hi - 1);
  if (ctx.intimacy === "broadcast") hi = Math.min(hi + 1, 5);
  if (ctx.avoid?.includes("too_strong")) {
    lo = Math.max(1, lo - 1);
    hi = Math.max(lo, hi - 1);
  }
  // 高张力场合（前任婚礼 / 谈判 / 见家长）：目标是"不被记住是因为香水"，一律再收一档
  if (ctx.tension === "high") hi = Math.max(lo, hi - 1);
  // 反馈闭环：你多次觉得"太冲"(perceivedStrength>0)→少喷；"太淡"(<0)→多喷。兑现"下次帮你少喷半下"
  const ps = bias?.perceivedStrength ?? 0;
  if (ps >= 0.4) {
    hi = Math.max(1, hi - 1);
    if (ps >= 0.7) lo = Math.max(1, lo - 1);
  } else if (ps <= -0.4) {
    hi = Math.min(hi + 1, 5);
  }
  // 不变式收口：任何修正路径都不允许出现 "2–1 下" 这种反向区间
  lo = Math.max(1, Math.min(lo, hi));
  hi = Math.max(lo, hi);

  // 到这里为止得出的 hi 是"这个场合 × 这个天气 × 这瓶香，最多能喷几下"的安全上限。
  // 它由封闭空间、餐桌、闷热、用力过猛组合等安全阀共同压出来，与个人偏好无关。
  const safetyCap = hi;

  // 成功配置复用：同温度档 × 同场合你反馈过「刚好」→ 按那次的量来。
  // 但它只能在安全上限之内复用——"上次刚好"记的是上次的场合，覆盖不了今天更封闭的会议室、
  // 更闷的天、或这瓶香本身的用力过猛组合。个性化不能凌驾于安全阀之上。
  let note: string | undefined;
  const cfg = bias?.successConfigs?.find(
    (c) => c.occasion === ctx.occasion && c.tempBand === tempBand(ctx.tempC)
  );
  if (cfg) {
    const remembered = Math.max(1, Math.min(5, cfg.sprays));
    const applied = Math.max(1, Math.min(remembered, safetyCap));
    lo = hi = applied;
    note =
      applied < remembered
        ? "上次同样天气、同样场合你说「刚好」——不过今天这个场合更收着些，先按更少的量来。"
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

  const risks = computeRisks(p, ctx);

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
    suitable: risks.length === 0,
    note,
  };
}

export function computeRisks(p: Perfume, ctx: Context): string[] {
  const risks: string[] = [];
  // 无香场合：只说这一条，不要再堆别的风险——用户此刻只需要一个结论
  if (ctx.fragranceFree) {
    return ["医院、诊所这类场合，很多人对气味格外敏感，而他们没有回避的余地——今天把香水留在家里最稳妥。"];
  }
  const density = DENSITY[ctx.occasion] ?? "normal";

  if (p.sillageTier >= 4 && (density === "closed" || density === "dense")) {
    risks.push("空间偏封闭、人也多，这瓶气场较大——建议只喷 1 下，或换一瓶更贴肤的。");
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
  const sweet = sweetness(p);
  const balsam = balsamicWeight(p);
  const hot = ctx.feel === "hot_humid" || ctx.feel === "hot_dry";
  if (hot) {
    const weatherWord = ctx.feel === "hot_humid" ? "又热又潮" : "这么热";
    if (sweet >= 55) {
      risks.push(`今天${weatherWord}，它的甜感偏重，上身久了容易发腻，可考虑换清爽些的。`);
    } else if (balsam >= 55) {
      risks.push(`今天${weatherWord}，它的树脂琥珀感偏厚，高温里存在感会比你以为的更强，喷得收着些更稳。`);
    }
  }
  // 餐桌场合：浓香/甜香和食物气味打架（高端餐饮甚至明示谢绝浓香）
  if (ctx.meal && (Math.max(sweet, balsam) >= 55 || p.sillageTier >= 3)) {
    risks.push("这顿饭是场合的一部分——它的存在感会和食物气味打架，喷得比平时更收着些。");
  }
  // 「用力过猛」组合提示（国内语境：办公室里的浓甜白花有"柜姐感"联想）
  if (overdressedCombo(p, ctx)) {
    risks.push("甜和扩散都偏高，这类场合容易显得用力过猛——压到 1 下、放低位置会体面很多。");
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
      risks.push(`大家更多在${map[best[0]]}季用它，今天用会有点反季。`);
    }
  }
  // 高张力场合 × 存在感偏强：规则层自己就要说这句，不能只指望场景解析恰好返回 riskNote
  if (ctx.tension === "high" && p.sillageTier >= 3) {
    risks.push("这种场合，最好别让香水成为被讨论的那件事——它的存在感偏强，压到最低量、只留贴身的一点更稳妥。");
  }
  // 场景解析给出的社交风险（LLM 的场景常识以受控字段进入，不允许它自由发挥进正文）
  if (ctx.riskNote && !risks.some((r) => r.includes(ctx.riskNote!))) {
    risks.push(ctx.riskNote.endsWith("。") ? ctx.riskNote : ctx.riskNote + "。");
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
  const wp = WEATHER_PHRASE[parts.weatherTone](topAccords);
  if (wp) r.push(wp);
  if (parts.occasion >= 0.8) r.push(`风格（${p.styleTags.join("·")}）贴合${ctx.occasion === "date" ? "约会" : "今天的场合"}`);
  if (p.custom) r.push(`这瓶是你手动记录的，按所选香调的典型情况估计，用两次并反馈后会更准`);
  else if (p.lowVotes) r.push(`这瓶的社区数据还少，判断偏保守，你的反馈会让它更准`);
  if (r.length === 0) r.push(`${topAccords}的整体气质，和今天比较合拍`);
  return r;
}
