"use client";
// 全局：一次性加载香水目录 + 解析实时情境（定位→和风天气），跨页共享
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { Perfume, Weather } from "@/lib/types";
import { loadCatalog } from "@/lib/perfumes";
import { feelFromWeather } from "@/lib/season";
import { useStore } from "@/lib/store";

type LocState = "idle" | "locating" | "ok" | "denied" | "error";

interface AppCtx {
  catalog: Perfume[] | null;
  catalogError: boolean;
  weather: Weather | null;
  locState: LocState;
  resolveByCoords: () => void;
  resolveByCity: (city: string) => Promise<boolean>;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp must be used within AppProvider");
  return c;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [catalog, setCatalog] = useState<Perfume[] | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [locState, setLocState] = useState<LocState>("idle");
  const hydrated = useStore((s) => s.hydrated);
  const setStoredCity = useStore((s) => s.setCity);

  // 客户端手动 rehydrate 持久化状态（配合 store 的 skipHydration）
  useEffect(() => {
    useStore.persist.rehydrate();
  }, []);

  // 天气/时间成光：按真实时段切昼夜主题，按体感微调氛围色温
  useEffect(() => {
    const root = document.documentElement;
    const hour = new Date().getHours();
    root.dataset.theme = hour >= 6 && hour < 18 ? "day" : "night";
    if (weather) {
      const feel = feelFromWeather(weather.tempC, weather.humidity);
      if (feel === "cold" || feel === "hot_humid") root.dataset.weather = feel;
      else root.removeAttribute("data-weather");
    }
  }, [weather]);

  // 目录
  useEffect(() => {
    loadCatalog().then(setCatalog).catch(() => setCatalogError(true));
  }, []);

  const fetchByCity = useCallback(
    async (city: string): Promise<boolean> => {
      try {
        const r = await fetch(`/api/context?city=${encodeURIComponent(city)}`);
        const d = await r.json();
        if (d.error || d.tempC == null) return false;
        setWeather({ ...d, approximate: false });
        setLocState("ok");
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const resolveByCoords = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocState("denied");
      return;
    }
    setLocState("locating");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { longitude, latitude } = pos.coords;
          const r = await fetch(`/api/context?lon=${longitude}&lat=${latitude}`);
          const d = await r.json();
          if (d.error || d.tempC == null) {
            setLocState("error");
            return;
          }
          setWeather(d);
          setLocState("ok");
        } catch {
          setLocState("error");
        }
      },
      () => setLocState("denied"),
      { timeout: 9000, maximumAge: 10 * 60 * 1000 }
    );
  }, []);

  const resolveByCity = useCallback(
    async (city: string) => {
      const ok = await fetchByCity(city);
      if (ok) setStoredCity(city);
      return ok;
    },
    [fetchByCity, setStoredCity]
  );

  // 首次解析：必须等持久化 rehydrate 完成，才能读到记忆中的城市
  useEffect(() => {
    if (!hydrated || weather || locState === "locating") return;
    const city = useStore.getState().city;
    if (city) {
      fetchByCity(city);
    } else {
      resolveByCoords();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  return (
    <Ctx.Provider
      value={{ catalog, catalogError, weather, locState, resolveByCoords, resolveByCity }}
    >
      {children}
    </Ctx.Provider>
  );
}
