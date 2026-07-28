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
 * 中文数字 + 量词 = 伪精确。量词限定在时间与剂量上——这是"留香多久、喷几下、几毫升"
 * 三件我们只给档位与区间、绝不给点值的事。「大半个白天」「一臂」「三分之一」这类
 * 非计数表达不在其列，因为它们本来就是我们自己的措辞。
 */
const CN_NUM = "[〇零一二两三四五六七八九十百千]";
const CN_UNIT = "(?:小时|分钟|个小时|毫升|滴|下|喷|天|周|年)";
const CN_PSEUDO = new RegExp(`${CN_NUM}+(?:点${CN_NUM}+)?\\s*${CN_UNIT}`, "g");

export function findInventedNumbers(text: string, allowed: Set<string>): string[] {
  const t = normalize(text);
  const bad: string[] = [];
  for (const m of t.matchAll(/\d+(?:\.\d+)?/g)) {
    if (!allowed.has(m[0])) bad.push(m[0]);
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
  const bad: string[] = [];
  for (const m of t.matchAll(CN_PSEUDO)) {
    // 逐字出现在事实里 = 是我们自己的措辞，不是它编的
    if (!f.includes(m[0])) bad.push(m[0]);
  }
  return bad;
}
