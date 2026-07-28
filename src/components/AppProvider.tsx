"use client";
// 全局：一次性加载香水目录 + 解析实时情境（定位→和风天气），跨页共享
import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { Perfume, Weather } from "@/lib/types";
import { loadCatalog } from "@/lib/perfumes";
import { feelFromWeather } from "@/lib/season";
import { useStore, hasOwnData, shouldRehydrateOnStorage } from "@/lib/store";
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

  // 客户端手动 rehydrate 持久化状态（配合 store 的 skipHydration）。
  //
  // ⚠️ `useStore.persist` 可能根本不存在：storage 句柄拿不到时（Chrome「阻止所有 Cookie」、
  // 跨源沙箱 iframe、Firefox 关掉 dom.storage），zustand 走的是 `if (!storage) return config(...)`
  // 那条早退分支，`api.persist` 从头到尾没被赋值。裸调用会在这里抛 TypeError，
  // 而 AppProvider 挂在**根 layout** 上、app/error.tsx 只包 page 段接不住它，
  // 用户看到的是 Next 内置的英文 "Application error"。更糟的是 hydrated 永远为 false，
  // 于是我们专门为存储故障造的那条告知通道（SiteNotice）恰恰在存储彻底不可用时一个字都不显示。
  useEffect(() => {
    if (useStore.persist) {
      useStore.persist.rehydrate();
      return;
    }
    // 存储不可用：应用照常跑（这一次会话内的操作全都有效），只是什么也留不下——明说。
    useStore.setState({
      hydrated: true,
      persistError: "storage_unavailable",
    });
  }, []);

  // 多标签页：另一页写盘之后，这一页必须跟着把内存态重读一遍。
  //
  // persist 是**全量写、没有 merge**：两个标签页各自持有一份内存态，谁后点谁覆盖。
  // 于是在 A 页加了三瓶香、写了手记，回到早就开着的 B 页随手点一下反馈——
  // A 页那三瓶、那条手记、连同「演示香柜已退场」这个标记，一起被 B 页的旧快照盖掉，
  // 六瓶示例复活。而这些数据只有本机一份、没有云端，覆盖不可逆。
  //
  // 重读会让这一页跟上另一页的改动（zustand 的默认 merge 是持久化态覆盖内存态），
  // 代价是这一页上未落盘的临时选择可能被换掉——比静默丢掉别人写下的东西轻得多。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!shouldRehydrateOnStorage(e.key, useStore.getState().hydrateError)) return;
      void useStore.persist?.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
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
      // 这条路此前全程不置 locating：locState 从 idle 直接跳到 ok，
      // 中间整个 /api/context 往返（实测 367–652ms）都停在 idle，
      // 也就是情境栏的「没拿到你的位置」分支。走"记忆城市 / 演示城市"的人每次加载都中，
      // 不只首访。坐标那条路因为同步置了 locating 才没露出来。
      setLocState("locating");
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
    // 目录没到位就整体等一等。此前这条早退嵌在演示态守卫**内部**，柜非空的返场用户
    // 根本进不去：hydrated 翻真时跑一次直接 fetchByCity，catalog 落地后依赖变化再跑一次，
    // 那时天气还在飞、locState 还是 idle，入口守卫拦不住，于是每次打开都对
    // /api/context 打两次同参请求，把每分钟 20 次的预算对半砍。
    // 天气解析晚一两百毫秒无害，两条路统一等目录到位。
    if (!catalog && !catalogError) return;
    const s = useStore.getState();
    // 三道守卫缺一不可：读盘没出错、这台机器上没有任何属于他自己的东西、从未退出过演示。
    // 任何一条不满足就跳过，绝不能把演示数据写到用户自己的柜子上。
    // 第二道走 store 的 hasOwnData——它连香历与反馈一起看：柜清空了但香历还在，
    // 是产品自己承诺过的合法状态，不是"一台全新的空机器"。
    if (!s.hydrateError && !s.demo && !s.demoDismissed && !hasOwnData(s as unknown as Record<string, unknown>)) {
      // 六瓶要按英文名到目录里查 id（目录彻底失败就放弃演示、照常走定位）
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
