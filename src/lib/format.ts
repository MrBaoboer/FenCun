// 人话化表达 —— 全部区间/档位，绝不伪精确
import type { Season } from "./types";

// 社交距离：直接绑 sillage 四档，不按小数切。
//
// ⚠️ 这四档是**产品叙事，不是测量值**。projection / sillage 在学界没有公认的量化定义或测量协议
// （连测量装置都是私有专利），数据来源是社区评价者的主观投票。
// 所以档名可以生动，但**解释它的时候必须归因**——见下方 DISTANCE_ATTRIB，
// 详情展开处用它，避免把「整间屋都是它」说成客观事实。
export const DISTANCE_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: "贴身可闻",
  2: "一臂之内",
  3: "一桌之间",
  4: "整间屋都是它",
};
export const DISTANCE_HINT: Record<1 | 2 | 3 | 4, string> = {
  1: "适合电梯、会议等密闭场合",
  2: "正常社交距离可感，安全日常",
  3: "同桌或小房间能闻到，注意场合",
  4: "户外、夜场加分，密闭空间慎用",
};
/** 归因前缀：详情展开处用，把主观投票说成主观投票 */
export const DISTANCE_ATTRIB = "多数评价者的感受";

// 规格行副标签（按档，替代原写死的"近身可感"）
export const DISTANCE_SUB: Record<1 | 2 | 3 | 4, string> = {
  1: "密闭也安全",
  2: "日常安全",
  3: "注意场合",
  4: "密闭慎用",
};

// 留香：longevity 1..5 → 定性描述 + 可执行动作，绝不给小时数。
//
// 这条红线有真实的科学依据，不只是产品洁癖：**同一款香在不同人皮肤上的蒸发量差异达到统计显著水平，
// 是留香预测中最大的单一不确定性来源**。皮肤水合度、皮脂、表面粗糙度、体温调节都在起作用，
// 而这些我们一个都不知道。任何"留香 X 小时"都是把一个我们没有测量、也无法测量的量说成已知。
//
// 复核还指出：连"约半天"里的那个「约」都仍然偏精确——它暗示背后有一次测量。
// 所以这里改成纯定性 + 一个可执行的动作建议（要不要带分装、什么时候补），
// 让这句话的信息量落在"你该怎么办"上，而不是落在一个假装知道的数字上。
export function durationHint(longevity: number | null): string {
  if (longevity == null) return "留香表现因人而异，用两次你就知道它在你身上能撑多久";
  // 「想起来就补一下」有轻微诱导过量的风险：过几小时你闻不到它，可能是它真的淡了，
  // 也可能只是你的鼻子对一直闻着的味道变钝了——而旁人的鼻子没有同步变钝。
  // 措辞纪律：**并列，不排序**。weak 级证据不足以断言哪个原因占主导，所以不写"那通常是鼻子适应了"。
  if (longevity < 2)
    return "散得偏快，出门前喷。过几个小时你自己可能先闻不到——鼻子对一直闻着的味道会变钝，别人不一定同步；真想补，半下就够";
  if (longevity < 3) return "撑得住大半个白天，傍晚有正式场合值得补一次";
  if (longevity < 4) return "基本能陪你过完这一天的白天";
  return "留得住，晚上多半还在——少喷一点就够";
}

export const SEASON_NAME: Record<Season, string> = {
  winter: "冬季",
  spring: "春季",
  summer: "夏季",
  autumn: "秋季",
};

export const OCCASION_LABEL: Record<string, string> = {
  commute: "通勤",
  work: "上班",
  date: "约会",
  social: "聚会",
  formal: "正式场合",
  casual: "休闲",
  home: "居家",
  sport: "运动",
};

export function genderLabel(g: string): string {
  return g === "male" ? "偏男香" : g === "female" ? "偏女香" : "中性";
}

// 留香短标签（用于统计行）——同样只给档位词，不给"约"这类暗示测量过的字眼
export function durationShort(longevity: number | null): string {
  if (longevity == null) return "因人而异";
  if (longevity < 2) return "散得快";
  if (longevity < 3) return "大半个白天";
  if (longevity < 4) return "一整个白天";
  return "可能到夜晚";
}

// 紧凑档位词——与 DISTANCE_LABEL 同一套四档的速览简写（贴近/一臂/一桌/满室），
// 保证换瓶弹层、备选列表、香柜卡与推荐卡对同一瓶的"社交距离"叫法一致。
export const SILLAGE_WORD: Record<1 | 2 | 3 | 4, string> = {
  1: "贴肤",
  2: "一臂",
  3: "一桌",
  4: "满室",
};

// 名称展示：中文名为主、英文为辅；无中文名则英文作主、不带副名
export function nameParts(p: { name: string; nameZh: string | null }): {
  primary: string;
  secondary: string | null;
  primaryIsZh: boolean;
} {
  if (p.nameZh && p.nameZh.trim()) {
    return { primary: p.nameZh, secondary: p.name, primaryIsZh: true };
  }
  return { primary: p.name, secondary: null, primaryIsZh: false };
}
