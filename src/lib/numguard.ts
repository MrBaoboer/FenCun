// 数字白名单：反伪精确的代码级防线。
// 允许出现在 LLM 输出里的数字 = 我们递给它的事实字符串里出现过的数字；
// 事实之外的任何数字（"留香6.2小时""3.7ml"）都是编造——不辩解，整段退模板。
export function extractDigits(s: string): Set<string> {
  return new Set(s.match(/\d+(?:\.\d+)?/g) ?? []);
}

export function findInventedNumbers(text: string, allowed: Set<string>): string[] {
  const bad: string[] = [];
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) {
    if (!allowed.has(m[0])) bad.push(m[0]);
  }
  return bad;
}
