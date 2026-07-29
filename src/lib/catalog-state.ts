// 目录（主 1500 款 JSON）取数失败时，要不要在页面上告诉用户。
//
// 判据原本是 `catalogError && lib.length < userPerfumes.length`——它是为「满柜用户不要被
// 误显示成空柜」写的，逻辑对，但把**唯一还没有数据的那类用户**整个漏在了告知之外：
// 空柜新访客的 lib.length 与 userPerfumes.length 同为 0，`0 < 0` 恒假，于是目录挂掉时
// 他看到的是一个把每次搜索都答成「没搜到」的搜索框，没有重试、没有解释，
// 而页面正文还举着「试试搜『香奈儿』」——正是刚才搜不出来的那个词。
//
// 实测（把 perfumes.min.json 与 ext-index.json 改名后刷新 /library）：两处请求均 404，
// 搜索下拉只有「没搜到」，整页没有任何「重新加载」按钮；今日页同样只显示 EmptyShelf，
// 点进去就是这个死循环。而这恰恰是从简历/GitHub 点进来的人的第一屏。
//
// 所以补上第二个入口：柜是空的时候，目录失败本身就值得说。
export function shouldShowCatalogError(
  catalogError: boolean,
  libCount: number,
  ownedCount: number
): boolean {
  if (!catalogError) return false;
  return ownedCount === 0 || libCount < ownedCount;
}
