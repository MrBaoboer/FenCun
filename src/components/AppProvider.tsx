"use client";
// 全局：一次性加载香水目录 + 解析实时情境（定位→和风天气），跨页共享
import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { Perfume, Weather } from "@/lib/types";
import { loadCatalog } from "@/lib/perfumes";
import { feelFromWeather } from "@/lib/season";
import { useStore } from "@/lib/store";
import { buildDemoState } from "@/lib/demo";

type LocState = "idle" | "locating" | "ok" | "denied" | "error";

interface AppCtx {
  catalog: Perfume[] | null;
  catalogError: boolean;
  retryCatalog: () => void;
  weather: Weather | null;
  locState: LocState;
  resolveByCoords: () => void;
  resolveByCity: (city: string) => Promise<boolean>;
  nowMinute: number; // 分钟级时钟节拍：跨时段/午夜时驱动情境重算
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
  const [nowMinute, setNowMinute] = useState(() => Date.now());
  const hydrated = useStore((s) => s.hydrated);
  const setStoredCity = useStore((s) => s.setCity);

  // 客户端手动 rehydrate 持久化状态（配合 store 的 skipHydration）
  useEffect(() => {
    useStore.persist.rehydrate();
  }, []);

  // 分钟级时钟节拍（回到前台/聚焦时也补一拍）：驱动情境/主题重算与天气保鲜（超 30 分钟静默重取，见下方），
  // 让长开标签页跨时段/午夜时不再冻结在打开那一刻
  useEffect(() => {
    const bump = () => setNowMinute(Date.now());
    const id = setInterval(bump, 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") bump();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", bump);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", bump);
    };
  }, []);

  // 天气成光：按体感微调氛围色温（寒凉偏冷、闷热偏润），这是**在当前主题之内**的微调，
  // 不改主题本身。
  //
  // 主题本身这里一个字都不写：它已经由 layout 的内联脚本在首帧定死（默认明韵，
  // 用户切过才是暗香），之后的唯一改写方是 ThemeToggle。
  // 这里原本挂着一份「按 hour 判断昼夜」的逻辑，而且依赖 nowMinute 分钟节拍——
  // 于是页面开着跨过 18:00 会当着用户的面自己翻成暗色。主题是产品的固定面貌，不该自己变。
  useEffect(() => {
    const root = document.documentElement;
    if (!weather) return;
    const feel = feelFromWeather(weather.tempC, weather.humidity);
    if (feel === "cold" || feel === "hot_humid") root.dataset.weather = feel;
    else root.removeAttribute("data-weather");
  }, [weather]);

  // 浏览器 chrome 的 theme-color 跟随应用主题（data-theme 是唯一事实源）：
  // 应用主题默认明韵、只由手动切换改写，而非 prefers-color-scheme，两套口径不能各走各的
  useEffect(() => {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    const sync = () =>
      meta!.setAttribute(
        "content",
        // 取值必须跟着 --color-paper 走（globals.css:10 / :60）
        document.documentElement.dataset.theme === "night" ? "#131315" : "#f1eee7"
      );
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  // 目录加载：失败自动重试一次；仍失败才置 error（供 UI 显示"重试"，绝不把满柜误判为空柜）
  const loadCatalogSafe = useCallback(() => {
    const attempt = (isRetry: boolean) => {
      loadCatalog()
        .then((c) => {
          setCatalog(c);
          setCatalogError(false);
        })
        .catch(() => {
          if (!isRetry) setTimeout(() => attempt(true), 1500);
          else setCatalogError(true);
        });
    };
    attempt(false);
  }, []);
  const retryCatalog = useCallback(() => {
    setCatalogError(false);
    loadCatalogSafe();
  }, [loadCatalogSafe]);
  useEffect(() => {
    loadCatalogSafe();
  }, [loadCatalogSafe]);

  // 天气保鲜的记账：最近一次成功获取的时间 + 来源（城市 or 坐标），供 30 分钟后静默重取
  const weatherFetchedAtRef = useRef<number | null>(null);
  const lastSourceRef = useRef<
    { kind: "city"; city: string } | { kind: "coords"; lon: number; lat: number } | null
  >(null);

  const fetchByCity = useCallback(
    async (city: string): Promise<boolean> => {
      try {
        const r = await fetch(`/api/context?city=${encodeURIComponent(city)}`);
        const d = await r.json();
        if (d.error || d.tempC == null) return false;
        setWeather({ ...d, approximate: false });
        setLocState("ok");
        weatherFetchedAtRef.current = Date.now();
        lastSourceRef.current = { kind: "city", city };
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
          // 截断到两位小数（≈1.1km 网格）**再**发出去。服务端自己的 gridKey 就是 toFixed(2)，
          // 也就是说满精度的那几位从来没有被消费过，却会原样落进 Vercel 访问日志、
          // 再转发给和风——对一个"定位只为了取天气"的功能，这是零收益的精度外泄。
          // 附带好处：同一网格内的重复请求现在必然命中缓存。
          const lon = pos.coords.longitude.toFixed(2);
          const lat = pos.coords.latitude.toFixed(2);
          const r = await fetch(`/api/context?lon=${lon}&lat=${lat}`);
          const d = await r.json();
          if (d.error || d.tempC == null) {
            setLocState("error");
            return;
          }
          setWeather(d);
          setLocState("ok");
          weatherFetchedAtRef.current = Date.now();
          // 存截断值：30 分钟后的静默重取走同一个网格，缓存必中
          lastSourceRef.current = { kind: "coords", lon: Number(lon), lat: Number(lat) };
        } catch {
          setLocState("error");
        }
      },
      () => setLocState("denied"),
      { timeout: 9000, maximumAge: 10 * 60 * 1000 }
    );
  }, []);

  const lastCityRef = useRef<string | null>(null);
  const inflightRef = useRef(false);
  const resolveByCity = useCallback(
    async (city: string) => {
      if (inflightRef.current) return false; // 防并发重复请求
      if (lastCityRef.current === city) return true; // 同城去重，不重复打接口
      inflightRef.current = true;
      const ok = await fetchByCity(city);
      inflightRef.current = false;
      if (ok) {
        setStoredCity(city);
        lastCityRef.current = city;
      }
      return ok;
    },
    [fetchByCity, setStoredCity]
  );

  // 首次解析：必须等持久化 rehydrate 完成，才能读到记忆中的城市。
  //
  // 演示香柜（黄金集）的装载也压在这里，而不是另起一个 effect——因为它自带城市，
  // 必须**先于**定位解析落地，否则会白弹一次定位授权框、再被演示城市覆盖。
  // 两件事共用一个 effect 就天然保证了顺序，也省掉一个只为排序而存在的 state。
  useEffect(() => {
    if (!hydrated || weather || locState === "locating") return;
    const s = useStore.getState();
    // 三道守卫缺一不可：读盘没出错、柜真的是空的、从未退出过演示。
    // 任何一条不满足就跳过，绝不能把演示数据写到用户自己的柜子上。
    if (!s.hydrateError && !s.demo && !s.demoDismissed && s.userPerfumes.length === 0 && s.customPerfumes.length === 0) {
      // 六瓶要按英文名到目录里查 id，所以必须等目录到位；目录彻底失败才放弃演示、照常走定位
      if (!catalog && !catalogError) return;
      const d = buildDemoState(catalog, Date.now());
      if (d) useStore.getState().enterDemo(d);
    }
    const city = useStore.getState().city;
    if (city) {
      // 记忆城市：接口失败/超时也要落到 error，触发 useResolvedContext 的季节+时段降级（否则返场用户卡在 idle→零推荐）
      fetchByCity(city).then((ok) => {
        if (!ok) setLocState("error");
      });
    } else {
      resolveByCoords();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, catalog, catalogError]);

  // 天气保鲜：拿到过天气后，超过 30 分钟就按上次的城市/坐标静默重取（服务端本有 30 分钟网格缓存，成本极低）。
  // 失败纯静默：保留旧天气与现有降级链，等下一个 30 分钟窗口再试；绝不弹状态、不动 locState。
  const refreshInflightRef = useRef(false);
  useEffect(() => {
    if (!weather || weatherFetchedAtRef.current == null) return;
    if (Date.now() - weatherFetchedAtRef.current < 30 * 60 * 1000) return;
    const src = lastSourceRef.current;
    if (!src || refreshInflightRef.current) return;
    refreshInflightRef.current = true;
    const url =
      src.kind === "city"
        ? `/api/context?city=${encodeURIComponent(src.city)}`
        : `/api/context?lon=${src.lon}&lat=${src.lat}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (d.error || d.tempC == null) return;
        // 与首取口径一致：城市来源明确非近似；坐标来源以接口返回为准
        setWeather(src.kind === "city" ? { ...d, approximate: false } : d);
      })
      .catch(() => {})
      .finally(() => {
        // 成败都推进时间戳：失败时静默退避到下个窗口，避免每分钟重试打接口
        weatherFetchedAtRef.current = Date.now();
        refreshInflightRef.current = false;
      });
  }, [nowMinute, weather]);

  return (
    <Ctx.Provider
      value={{ catalog, catalogError, retryCatalog, weather, locState, resolveByCoords, resolveByCity, nowMinute }}
    >
      {children}
    </Ctx.Provider>
  );
}
