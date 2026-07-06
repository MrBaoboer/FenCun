"use client";
// 客户端状态（香水库 + 反馈 + 偏好），持久化到 localStorage
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { UserPerfume, Feedback, Occasion, ScenePatch } from "./types";

interface State {
  userPerfumes: UserPerfume[];
  feedbacks: Feedback[];
  city: string | null; // 手动城市覆盖（定位失败时用）
  occasion: Occasion;
  scene: ScenePatch | null; // 自然语言场景（覆盖 occasion）
  hydrated: boolean;
  // 证伪指标（本机埋点）：换香率与吃灰采纳率的原始计数——用来验证需求是否真实发生
  swapCount: number;
  dustyAdoptCount: number;

  addPerfume: (id: number) => void;
  removePerfume: (id: number) => void;
  markWorn: (id: number) => void;
  addFeedback: (fb: Feedback) => void;
  setCity: (c: string | null) => void;
  setOccasion: (o: Occasion) => void;
  setScene: (s: ScenePatch | null) => void;
  hasPerfume: (id: number) => boolean;
  recordSwap: () => void;
  recordDustyAdopt: () => void;
  exportData: () => string;
  importData: (raw: string) => boolean;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      userPerfumes: [],
      feedbacks: [],
      city: null,
      occasion: "commute",
      scene: null,
      hydrated: false,
      swapCount: 0,
      dustyAdoptCount: 0,

      addPerfume: (id) =>
        set((s) =>
          s.userPerfumes.some((u) => u.perfumeId === id)
            ? s
            : { userPerfumes: [...s.userPerfumes, { perfumeId: id, addedAt: Date.now() }] }
        ),
      removePerfume: (id) =>
        set((s) => ({ userPerfumes: s.userPerfumes.filter((u) => u.perfumeId !== id) })),
      // 采纳/就用它 → 记一笔穿戴：刷新 lastWornAt（吃灰口径）+ 累加 wornCount（常喷口径）
      markWorn: (id) =>
        set((s) => ({
          userPerfumes: s.userPerfumes.map((u) =>
            u.perfumeId === id
              ? { ...u, lastWornAt: Date.now(), wornCount: (u.wornCount ?? 0) + 1 }
              : u
          ),
        })),
      addFeedback: (fb) => set((s) => ({ feedbacks: [...s.feedbacks, fb].slice(-400) })),
      setCity: (c) => set({ city: c }),
      setOccasion: (o) => set({ occasion: o, scene: null }), // 手动选场合即清除自然语言场景
      setScene: (s) => set({ scene: s }),
      hasPerfume: (id) => get().userPerfumes.some((u) => u.perfumeId === id),
      recordSwap: () => set((s) => ({ swapCount: s.swapCount + 1 })),
      recordDustyAdopt: () => set((s) => ({ dustyAdoptCount: s.dustyAdoptCount + 1 })),
      exportData: () => {
        const s = get();
        return JSON.stringify(
          {
            version: 1,
            exportedAt: Date.now(),
            userPerfumes: s.userPerfumes,
            feedbacks: s.feedbacks,
            city: s.city,
            occasion: s.occasion,
            swapCount: s.swapCount,
            dustyAdoptCount: s.dustyAdoptCount,
          },
          null,
          2
        );
      },
      importData: (raw) => {
        try {
          const d = JSON.parse(raw);
          if (!d || !Array.isArray(d.userPerfumes)) return false;
          set((s) => ({
            userPerfumes: d.userPerfumes,
            feedbacks: Array.isArray(d.feedbacks) ? d.feedbacks.slice(-400) : s.feedbacks,
            city: typeof d.city === "string" ? d.city : s.city,
            occasion: d.occasion ?? s.occasion,
            swapCount: typeof d.swapCount === "number" ? d.swapCount : s.swapCount,
            dustyAdoptCount:
              typeof d.dustyAdoptCount === "number" ? d.dustyAdoptCount : s.dustyAdoptCount,
          }));
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: "fencun-store",
      // 服务端无 localStorage → 返回 undefined，persist 自动跳过；客户端正常持久化
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : (undefined as unknown as Storage)
      ),
      // 跳过自动 hydrate，改由 AppProvider 在挂载后手动 rehydrate，避免 SSR/客户端首屏不一致
      skipHydration: true,
      partialize: (s) => ({
        userPerfumes: s.userPerfumes,
        feedbacks: s.feedbacks,
        city: s.city,
        occasion: s.occasion,
        swapCount: s.swapCount,
        dustyAdoptCount: s.dustyAdoptCount,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    }
  )
);
