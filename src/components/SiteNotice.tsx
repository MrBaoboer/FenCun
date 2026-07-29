"use client";
// 读盘失败的止损提示。**只在出错时出现**，正常使用永远看不到它。
//
// 为什么值得占一条全站通栏：读不出来和新用户在界面上长得一模一样——都是一个正常渲染的空香柜。
// 用户不知情地加一瓶，这次写入就把盘上仍然完整的数据覆盖掉了。这条提示是让他停手的唯一机会。
//
//（演示香柜刻意**不**在这里自报身份：常驻横幅对初次到访的人是打扰。
//  它的身份与退出入口都放在「我的 · 数据」那一栏，见 app/profile/page.tsx。）
import { useState } from "react";
import { useStore } from "@/lib/store";

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="border-t border-warn/30 bg-warn-wash">
      <div className="mx-auto max-w-2xl px-6 py-3">
        <p className="serif text-[0.88rem] leading-relaxed text-ink">{children}</p>
      </div>
    </div>
  );
}

export function SiteNotice() {
  const hydrated = useStore((s) => s.hydrated);
  const hydrateError = useStore((s) => s.hydrateError);
  const persistError = useStore((s) => s.persistError);
  const storageWiped = useStore((s) => s.storageWiped);
  const restoreFromBackup = useStore((s) => s.restoreFromBackup);
  const hasRescueBackup = useStore((s) => s.hasRescueBackup);
  const [rescue, setRescue] = useState<"idle" | "failed" | "ok">("idle");
  // 读盘失败时另存的那份原始字节此前没有任何入口——字节还在，用户却取不回来，
  // 等于没有恢复路径。挂载后才问（hydrated 已保证在客户端），避免 SSR 读 localStorage。
  const canRescue = hydrated && rescue === "idle" && hasRescueBackup();
  if (!hydrated) return null;

  // 读盘失败优先：盘上还有数据没读出来，这时最要紧的是让用户先停手
  if (hydrateError)
    return (
      <Banner>
        这台机器上的数据没能读出来。<b className="font-bold">先别添加香水</b>——新记录会把它覆盖掉。
        {rescue === "failed" ? (
          <> 备份也没能恢复，到「我的」里导入你自己的备份文件。</>
        ) : canRescue ? (
          <>
            {" "}
            可以
            <button
              type="button"
              onClick={async () => setRescue((await restoreFromBackup()) ? "ok" : "failed")}
              className="mx-0.5 font-bold underline underline-offset-2"
            >
              试着恢复备份
            </button>
            ，或到「我的」里导入你自己的备份文件。
          </>
        ) : (
          <> 可以到「我的」里导入你的备份文件。</>
        )}
      </Banner>
    );

  // 盘被抹掉：排在写盘失败之前，因为这一条的紧迫性更高——内存里这份是最后一份了。
  // 措辞刻意不追问是谁抹的（浏览器清除数据、另一标签页、扩展），只说清现状与唯一的出路。
  if (storageWiped)
    return (
      <Banner>
        这台机器上的记录<b className="font-bold">已被清空</b>。这一页里的还在，但<b className="font-bold">不会</b>
        再存回去——想留下就到「我的」里导出一份。
      </Banner>
    );

  // 写盘失败：这一屏上的操作全都有效，只是关掉页面就没了。说清楚，别让它无声地丢。
  if (persistError)
    return (
      <Banner>
        {/* 整句不折行：JSX 会把行中间的换行折成一个空格，折在「——」前会多出一个空隙 */}
        这台机器现在<b className="font-bold">存不下东西</b>。这次的操作照常有效，但关掉页面就会消失——想保住已有的记录，到「我的」里导出一份。
      </Banner>
    );

  return null;
}
