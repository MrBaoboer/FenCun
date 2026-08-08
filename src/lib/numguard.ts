// 数字白名单：反伪精确的代码级防线。
// 允许出现在 LLM 输出里的数字 = 我们递给它的事实字符串里出现过的数字；
// 事实之外的任何数字（"留香6.2小时""3.7ml"）都是编造——不辩解，整段退模板。
//
// ⚠️ 这道防线此前只覆盖**半角**一种书写形态，而 SYSTEM 提示词是中文的：
// 模型写「能撑六到八个小时」比写「6.2 小时」自然得多，写「６.２小时」也不难。
// JS 的 \d 恒等 [0-9]（与 u/v 标志无关），这两种形态在旧正则里根本不存在，
// 命中时 findInventedNumbers 返回空数组、整段照原样放行、source 还标成 deepseek。
// 也就是说这个产品最硬的那条红线，在最可能发生的形态上是空的。
//
// 补的时候有两个坑，都踩过一次才写在这里：
//   ① 必须**两侧对称**做 NFKC 归一。只归一输出、不归一事实，「２」会因为在事实里
//      找不到「2」而被当成编造，反过来把我们自己给的数字拦下来。
//   ② 中文数字**不能**一律视为编造。事实包里本来就有中文数字——format.ts 的
//      「用两次你就知道…」「过几个小时你自己可能先闻不到」「撑得住大半个白天」，
//      usage.ts 的「用两次并反馈后会更准」。一律拦下等于让防线把自己的事实吃掉，
//      而且是静默降级（永远退模板，source 永远是 template），没人会发现。
//      所以只拦「中文数字 + 时间/剂量量词」这一种真正构成伪精确的组合，
//      并且逐字出现在事实里的照样放行。

/** 全角数字、全角小数点等一律折回半角，让两侧比对在同一套字形上进行 */
function normalize(s: string): string {
  return s.normalize("NFKC");
}

export function extractDigits(s: string): Set<string> {
  return new Set(normalize(s).match(/\d+(?:\.\d+)?/g) ?? []);
}

/**
 * 中文数字 + 量词 = 伪精确。量词限定在时间、剂量与**距离**上——这是"留香多久、喷几下、
 * 隔多远闻得到"三件我们只给档位与区间、绝不给点值的事。「大半个白天」「一臂」「三分之一」
 * 这类非计数表达不在其列，因为它们本来就是我们自己的措辞。
 *
 * ⚠️ 第一版漏了两类，实测都能原样上屏（`invented = []`、source 标 deepseek）：
 *   ① **「半」不是数字**。于是「六个半小时」「一个半小时」「半小时」全部放行——
 *      而这恰恰比文件头举例的「六到八个小时」更像中文里的自然说法。
 *      根因是 CN_NUM 里没有「半」，且「个半」这种插入形态没被表达。
 *   ② **量词清单太窄**。「钟头」「秒」「泵」不在其中；距离侧更彻底——
 *      一个长度量词都没有，而社交距离正是产品只给四档的三件事之一，
 *      「扩散半径一米五」畅通无阻。
 *
 * 「大半」刻意排除在外（负向环视）：「大半天」「大半个白天」是我们自己的模糊措辞，
 * 本来就不构成伪精确，把它拦下只会让防线静默地把自家的话吃掉。
 *
 * ⚠️ 第三类漏网的方向是**反的**——它不是放行了伪精确，而是拦下了我们自己的话。
 * 「逐字出现在事实里就放行」这条判据，只认字形不认数值：事实里写的是半角
 * 「喷 2 下」，模型用自然中文复述成「喷两下」，逐字比对接不上，整段丢弃退模板。
 * 2026-08-08 线上实测这条是 DeepSeek 拿到正文之后的**第二道死门**
 *（日志：`guard at=invented_numbers detail="两下"` / `"一下"`）。
 * 修法见 findPseudoPreciseCN：中文整数先折算成阿拉伯数字，再按「数+量词」比对事实，
 * 放行的仍然只有"我们自己给过的那个量"，红线一寸没松。
 */
const CN_NUM = "[〇零一二两三四五六七八九十百千]";
/** 数量部分：六 / 六个 / 六个半 / 一个半 / 半 */
const CN_QTY = `(?:${CN_NUM}+个?半?|半)`;
const CN_UNIT = "(?:小时|分钟|钟头|秒|毫升|滴|下|喷|泵|米|厘米|公分|步|天|周|年)";
const CN_PSEUDO = new RegExp(
  `(?<!大)(?<qty>${CN_QTY})(?<frac>点${CN_NUM}+)?\\s*个?\\s*(?<unit>${CN_UNIT})`,
  "g"
);

/**
 * 中文整数 → 数值。折算不出来（含「半」「点」等非整数形态、或压根不是数）就返回 null。
 *
 * 只服务于一件事：判断「两下」说的是不是我们给过的那个「2 下」。所以刻意只做整数——
 * 带「半」「点」的粒度比我们给出的任何档位都细（我们从不说「2.5 下」），折算出来的数
 * 不可能在事实里，放行它就等于放行伪精确。这条限制在调用处显式表达，见下。
 *
 * 导出是为了可测：它是红线上的一个新判据，必须有东西守着。
 */
export function cnIntToNumber(s: string): number | null {
  const DIGIT: Record<string, number> = {
    〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  const UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let digit = -1;
  let seen = false;
  for (const ch of s) {
    if (ch in DIGIT) {
      digit = DIGIT[ch];
      seen = true;
    } else if (ch in UNIT) {
      // 「十五」的十前面没有数字，按 1 算；「二十」的十前面有 2
      total += (digit >= 0 ? digit : 1) * UNIT[ch];
      digit = -1;
      seen = true;
    } else {
      return null;
    }
  }
  if (!seen) return null;
  if (digit >= 0) total += digit;
  return total;
}

export function findInventedNumbers(text: string, allowed: Set<string>): string[] {
  const t = normalize(text);
  const bad: string[] = [];
  for (const m of t.matchAll(/\d+(?:\.\d+)?/g)) {
    if (!allowed.has(m[0])) bad.push(m[0]);
  }
  return bad;
}

/**
 * 半角数字 + 量词，比对的是**这个数配这个单位**我们给过没有。
 *
 * findInventedNumbers 只做集合成员判定，不看数字出现在什么语境、原来是什么单位。
 * 而事实包里恒有两个小整数是**气温**与**湿度**：tempC 落在 -60~60（其中 0~12 全年
 * 有相当长时间像小时数），humidity 恒在 0~100（永远像分钟、厘米或百分比）。
 * 实测白名单 ['6','40','2'] 下，这三句全部放行、invented 为空、source 标 deepseek：
 *   「留香 6 小时左右，喷 2 下就够」   ← 6 原本是气温
 *   「扩散半径大约 40 厘米」            ← 40 原本是湿度
 *   「建议喷 6 下，能顶 40 分钟」       ← 两个都换了槽位
 * 只有小数形态（6.2）会被拦下。也就是说反伪精确在它**最可能被突破的形态**上是通的：
 * 模型并不需要编一个新数字，把我们给的数字挪个单位就够了。
 *
 * 所以量词这一侧改成成对比对：从事实里抽出所有「数+量词」组合（区间按端点展开，
 * 「2–3 下」同时放行「2 下」与「3 下」），输出里出现的组合不在其中即判编造。
 * 量词范围与中文那一侧刻意一致——留香、喷量、社交距离，正是只给档位与区间的三件事。
 * 百分比与温度不在其中：它们本来就是我们逐字给出的读数，不构成"点值承诺"。
 */
const AR_UNIT = "(?:小时|分钟|钟头|秒|毫升|ml|滴|下|喷|泵|厘米|公分|米|cm|天|周)";
const AR_PAIR = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*个?\\s*(${AR_UNIT})`, "g");
/** 区间：2–3 下 / 2-3 下 / 2~3 下 / 2 到 3 下 */
const AR_RANGE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:[-–—~～]|到|至)\\s*(\\d+(?:\\.\\d+)?)\\s*个?\\s*(${AR_UNIT})`, "g");

/** 事实里出现过的「数+量词」组合，区间按两个端点展开 */
export function allowedUnitPairs(facts: string): Set<string> {
  const f = normalize(facts);
  const out = new Set<string>();
  for (const m of f.matchAll(AR_RANGE)) {
    out.add(`${m[1]}${m[3]}`);
    out.add(`${m[2]}${m[3]}`);
  }
  for (const m of f.matchAll(AR_PAIR)) out.add(`${m[1]}${m[2]}`);
  return out;
}

export function findUnitMismatch(text: string, allowedPairs: Set<string>): string[] {
  const t = normalize(text);
  const bad: string[] = [];
  for (const m of t.matchAll(AR_PAIR)) {
    if (!allowedPairs.has(`${m[1]}${m[2]}`)) bad.push(m[0]);
  }
  return bad;
}

/**
 * 中文数字形态的伪精确。与 findInventedNumbers 分开导出，是因为它的放行判据不同：
 * 数字比对的是"这个数给过没有"，中文短语比对的是"这句话我们自己说过没有"。
 * @param facts 递给 LLM 的事实原文（未经 JSON 转义的拼接即可）
 */
export function findPseudoPreciseCN(text: string, facts: string): string[] {
  const t = normalize(text);
  const f = normalize(facts);
  // 事实里我们自己给过的「数+量词」组合，与 findUnitMismatch 用的是同一套抽取
  //（区间按端点展开：给了「2–3 下」，「两下」与「三下」都算我们说过）
  const pairs = allowedUnitPairs(f);
  const bad: string[] = [];
  for (const m of t.matchAll(CN_PSEUDO)) {
    // ① 逐字出现在事实里 = 是我们自己的措辞，不是它编的
    if (f.includes(m[0])) continue;
    const g = m.groups;
    // ② 同一个量的另一种写法，也是我们自己的措辞。事实写「喷 2 下」、模型写「喷两下」，
    //    说的是同一件事，只是中文里后者才自然——按字形比对会把它判成编造，
    //    然后整段丢弃退模板，而这正是线上第二道死门。
    //
    //    放行面刻意只开到「纯中文整数 + 量词」这一种形态：带「半」「点」的粒度比我们
    //    给出的任何档位都细（我们从不说「2.5 下」），折算出来的数不可能在事实里，
    //    所以「六个半小时」「六点五小时」照旧拦——红线一寸没松，只是不再吃掉自家的话。
    if (g && !g.frac && !g.qty.includes("半")) {
      const n = cnIntToNumber(g.qty.replace(/个$/, ""));
      if (n !== null && pairs.has(`${n}${g.unit}`)) continue;
    }
    bad.push(m[0]);
  }
  return bad;
}

/**
 * 这段文本里带不带"数"——**给白名单的入口把关用**，与上面两个出口方向相反。
 *
 * 白名单的口径是「事实里出现过的数字可以说」，它的前提是事实全部由规则引擎算出。
 * 但有一条事实是用户自己写的：场景解析返回的 riskNote 由 LLM 从用户原话生成，
 * 经 computeRiskNotes 逐字下推进 risks[]，再被 explain 收进 allowedNumbers。
 * 于是用户在场景里写一句「会议约 6.2 小时」，6.2 就成了"我们给过的数"——
 * 实测 LLM 随后输出「留香 6.2 小时」时 `invented = []`，原样上屏且 source 标 deepseek。
 * explain 路由里那句「刻意排除用户自由文本」的注释，被这条路径从背后绕开了。
 *
 * 修在源头：riskNote 是一句社交常识（"婚礼焦点是新人，不宜喧宾夺主"），
 * 本来就没有携带数字的理由——带了就整条丢掉，它是 optional 字段，丢掉不影响其余补丁。
 */
export function carriesNumber(text: string): boolean {
  const t = normalize(text);
  return /\d/.test(t) || new RegExp(CN_PSEUDO.source).test(t);
}
