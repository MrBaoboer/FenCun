"use client";
// 客户端状态（香水库 + 反馈 + 偏好），持久化到 localStorage
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { UserPerfume, Feedback, Occasion } from "./types";

interface State {
  userPerfumes: UserPerfume[];
  feedbacks: Feedback[];
  city: string | null; // 手动城市覆盖（定位失败时用）
  occasion: Occasion;
  hydrated: boolean;

  addPerfume: (id: number) => void;
  removePerfume: (id: number) => void;
  markWorn: (id: number) => void;
  addFeedback: (fb: Feedback) => void;
  setCity: (c: string | null) => void;
  setOccasion: (o: Occasion) => void;
  hasPerfume: (id: number) => boolean;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      userPerfumes: [],
      feedbacks: [],
      city: null,
      occasion: "commute",
      hydrated: false,

      addPerfume: (id) =>
        set((s) =>
          s.userPerfumes.some((u) => u.perfumeId === id)
            ? s
            : { userPerfumes: [...s.userPerfumes, { perfumeId: id, addedAt: Date.now() }] }
        ),
      removePerfume: (id) =>
        set((s) => ({ userPerfumes: s.userPerfumes.filter((u) => u.perfumeId !== id) })),
      markWorn: (id) =>
        set((s) => ({
          userPerfumes: s.userPerfumes.map((u) =>
            u.perfumeId === id ? { ...u, lastWornAt: Date.now() } : u
          ),
        })),
      addFeedback: (fb) => set((s) => ({ feedbacks: [...s.feedbacks, fb] })),
      setCity: (c) => set({ city: c }),
      setOccasion: (o) => set({ occasion: o }),
      hasPerfume: (id) => get().userPerfumes.some((u) => u.perfumeId === id),
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
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    }
  )
);
