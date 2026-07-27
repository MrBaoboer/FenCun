"use client";
// 读盘失败的止损提示。**只在出错时出现**，正常使用永远看不到它。
//
// 为什么值得占一条全站通栏：读不出来和新用户在界面上长得一模一样——都是一个正常渲染的空香柜。
// 用户不知情地加一瓶，这次写入就把盘上仍然完整的数据覆盖掉了。这条提示是让他停手的唯一机会。
//
//（演示香柜刻意**不**在这里自报身份：常驻横幅对初次到访的人是打扰。
//  它的身份与退出入口都放在「我的 · 数据」那一栏，见 app/profile/page.tsx。）
import { useStore } from "@/lib/store";

export function SiteNotice() {
  const hydrated = useStore((s) => s.hydrated);
  const hydrateError = useStore((s) => s.hydrateError);
  if (!hydrated || !hydrateError) return null;

  return (
    <div role="alert" className="border-t border-warn/30 bg-warn-wash">
      <div className="mx-auto max-w-2xl px-6 py-3">
        <p className="serif text-[0.88rem] leading-relaxed text-ink">
          这台机器上的数据没能读出来。原始内容已另存一份，<b className="font-bold">先别添加香水</b>
          ——新的记录会覆盖掉它。可以到「我的」里导入你的备份文件。
        </p>
      </div>
    </div>
  );
}
