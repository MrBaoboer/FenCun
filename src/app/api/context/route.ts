// 情境感知：服务端代理和风天气（保护 key），带 30 分钟网格缓存，失败优雅降级
import { NextRequest, NextResponse } from "next/server";
import { allow, clientKey, withinWeatherBudget } from "@/lib/ratelimit";

export const runtime = "nodejs";

const HOST = process.env.QWEATHER_HOST;
const KEY = process.env.QWEATHER_KEY;

interface CacheEntry<T> {
  at: number;
  data: T;
}
interface WeatherResult {
  tempC: number;
  humidity: number;
  windSpeed: number;
  text: string;
  city: string;
  approximate?: boolean;
}
interface GeoResult {
  lon: number;
  lat: number;
  name: string;
}

// 天气缓存：键只含网格坐标（不含时间桶）。
// 旧实现的键带 Math.floor(Date.now()/TTL) 时间桶，有两个问题：
// 1. 旧桶条目永不命中也永不删除，长热实例上是真·内存泄漏；
// 2. 桶边界处（如第 29 分钟写入）数据 1 分钟后即整体失效，实际 TTL 不稳定。
// 现在写入记 at，读取时按 now - at > TTL 判过期并删除；写入超上限时先清一遍过期项。
const weatherCache = new Map<string, CacheEntry<WeatherResult>>();
const WEATHER_TTL = 30 * 60 * 1000; // 30 分钟，保持原契约
const WEATHER_CACHE_MAX = 500;

// geo 缓存：城市名 → 坐标/城市名。城市坐标基本不变，TTL 给 24h。
// 旧实现按城市名进来的请求每次都打上游 /geo/v2/city/lookup，白耗额度。
const geoCache = new Map<string, CacheEntry<GeoResult>>();
const GEO_TTL = 24 * 60 * 60 * 1000;
const GEO_CACHE_MAX = 500;
// 负缓存：查不到的城市名此前不进任何缓存，于是同一个随机串每次都重打上游。
// TTL 短得多——城市名查不到多半是真的不存在，但也可能是上游一时抖动，不该记一天。
const geoMissCache = new Map<string, CacheEntry<true>>();
const GEO_MISS_TTL = 10 * 60 * 1000;

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string, ttl: number): T | undefined {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ttl) {
    map.delete(key);
    return undefined;
  }
  return hit.data;
}

function cacheSet<T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
  data: T,
  ttl: number,
  max: number
) {
  if (map.size >= max) {
    const now = Date.now();
    for (const [k, v] of map) {
      if (now - v.at > ttl) map.delete(k);
    }
    // 极端情况下（上限内全是新鲜条目）仍可能超限：按插入序淘汰最旧的，兜底防无限增长
    if (map.size >= max) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  }
  map.set(key, { at: Date.now(), data });
}

function gridKey(lon: number, lat: number) {
  return `${lon.toFixed(2)},${lat.toFixed(2)}`;
}

/** 日闸门触顶。走既有的 catch 落到 weather_unavailable，客户端契约不变 */
class WeatherBudgetExhausted extends Error {
  constructor() {
    super("weather daily budget exhausted");
  }
}

/**
 * 日闸门在**这里**消费，而不是在路由入口。
 *
 * 放在入口时它数的是「进站请求」，与和风的实际调用量没有任何对应关系，两个方向都错：
 * · 一次缓存命中扣 1 个 token 却打 0 次和风——30 分钟网格缓存省下的配额完全不反映在闸门上；
 * · 一次 miss 扣 1 个 token 却打 2 次和风（反查城市名 + 取实况）。
 * 于是 cap=5000 实际对应 0～10000 次调用，这个数字对配额没有约束力。
 *
 * 更要紧的是它当时还排在 allow() 与坐标校验**之前**：`?lon=999&lat=999` 这种
 * 直接 400、根本不碰和风的请求照样扣配额，单 IP 零成本就能把当天预算刷光，
 * 之后落到这个实例的所有真实用户当天只剩 weather_unavailable。
 * 对照 explain 那条路由是 `!allow(...) || !withinDailyBudget()`，限流在前、闸门在后——
 * 两条代理付费上游的路由口径相反，这条是错的那条。
 *
 * 挪到这里之后，计数器的语义就等于和风控制台里的调用次数。
 */
async function qweather(path: string, params: Record<string, string>) {
  if (!withinWeatherBudget()) throw new WeatherBudgetExhausted();
  const url = new URL(`https://${HOST}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // key 走请求头而非 URL query（和风官方支持 X-QW-Api-Key）：
  // query 里的 key 会进上游/中间层的访问日志与 Referer 泄露面，请求头不会。
  const res = await fetch(url, {
    headers: { "X-QW-Api-Key": KEY ?? "" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`qweather ${res.status}`);
  return res.json();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lon = sp.get("lon");
  const lat = sp.get("lat");
  const city = sp.get("city");

  if (!HOST || !KEY) {
    return NextResponse.json({ error: "weather_unconfigured" }, { status: 200 });
  }
  // 限流：单客户端 60 秒最多 20 次（切城市/定位）
  // 日闸门与 allow() 分工不同：allow 挡单客户端狂刷，它挡换 IP 的分布式刷量。
  // 闸门本身在 qweather() 里消费（见那里的说明）——它要数的是上游调用，不是进站请求。
  if (!allow(`ctx:${clientKey(req)}`, 20, 60_000)) {
    // 语义上该回 429，但客户端（AppProvider）只解析 body 判 d.error，
    // 返回 429 对它没有增益、反而可能把其他消费方打进降级链，
    // 所以保持 200 + 原响应体不变，只加 Retry-After 头方便规范客户端/脚本自行退避。
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 200, headers: { "Retry-After": "60" } }
    );
  }

  try {
    let lonNum: number, latNum: number, cityName: string;

    if (lon && lat) {
      lonNum = parseFloat(lon);
      latNum = parseFloat(lat);
      // 用区间判定而不是 isNaN：parseFloat("Infinity") 不是 NaN，`?lon=99999&lat=999`
      // 也照样通过。每个不同取值就是一个新的 gridKey，必然 miss，然后打两次上游
      //（反查城市名 + 取实况）——比构造一个能命中的城市名省事得多的配额放大路径。
      if (!(lonNum >= -180 && lonNum <= 180) || !(latNum >= -90 && latNum <= 90)) {
        return NextResponse.json({ error: "bad_coords" }, { status: 400 });
      }
      cityName = "";
    } else if (city) {
      // city 此前一个字都没校验。它经 searchParams.set 编码后拼进上游 URL，
      // 构造不出注入或 SSRF，所以这是**成本**问题不是安全问题：
      // 查不到的随机串永远不进 geoCache（下面只在查到时才写），于是每次都重打上游。
      // ⚠️ 控制字符只许写**转义形态**。这一行原本嵌的是两个裸字节（U+0000 与 U+001F），
      // 运行期没问题——坏的是工程可见性：git 因此把整个文件判成二进制，
      // `git show`/PR 页面对它只输出「Binary files differ」、一行 diff 都没有，
      // `grep` 与 `git grep` 也只回一句「Binary file matches」。
      // 全站唯一既校验不可信入参、又持有天气密钥的文件，恰好是评审里看不见的那一个，
      // 而 gitleaks 走的正是 git patch 通道。见 .gitattributes 与 ci-workflow.test.mjs 的同名断言。
      if (city.length > 40 || /[\x00-\x1f]/.test(city)) {
        return NextResponse.json({ error: "bad_city" }, { status: 400 });
      }
      // 查不到的城市名走一条短 TTL 的负缓存，堵住"随机串每次都打上游"这条路
      if (cacheGet(geoMissCache, city, GEO_MISS_TTL)) {
        return NextResponse.json({ error: "city_not_found" }, { status: 200 });
      }
      const geoHit = cacheGet(geoCache, city, GEO_TTL);
      if (geoHit) {
        lonNum = geoHit.lon;
        latNum = geoHit.lat;
        cityName = geoHit.name;
      } else {
        const geo = await qweather("/geo/v2/city/lookup", { location: city });
        const loc = geo?.location?.[0];
        if (!loc) {
          cacheSet(geoMissCache, city, true, GEO_MISS_TTL, GEO_CACHE_MAX);
          return NextResponse.json({ error: "city_not_found" }, { status: 200 });
        }
        lonNum = parseFloat(loc.lon);
        latNum = parseFloat(loc.lat);
        cityName = loc.name;
        if (!Number.isNaN(lonNum) && !Number.isNaN(latNum)) {
          cacheSet(geoCache, city, { lon: lonNum, lat: latNum, name: cityName }, GEO_TTL, GEO_CACHE_MAX);
        }
      }
    } else {
      return NextResponse.json({ error: "missing_location" }, { status: 400 });
    }

    const ck = gridKey(lonNum, latNum);
    const cached = cacheGet(weatherCache, ck, WEATHER_TTL);
    if (cached) {
      const data = cityName ? { ...cached, city: cityName } : cached;
      return NextResponse.json(data);
    }

    // 反查城市名（坐标定位时）
    if (!cityName) {
      try {
        const geo = await qweather("/geo/v2/city/lookup", { location: `${lonNum},${latNum}` });
        cityName = geo?.location?.[0]?.name ?? "你所在的位置";
      } catch (e) {
        // 闸门触顶要往上抛：这是"今天不再打和风了"，不是"这一次反查失败了"。
        // 吞掉它会让紧接着的取实况再撞一次同样的墙，白白多走一遍。
        if (e instanceof WeatherBudgetExhausted) throw e;
        cityName = "你所在的位置";
      }
    }

    const w = await qweather("/v7/weather/now", { location: `${lonNum},${latNum}` });
    if (w?.code !== "200" || !w?.now) {
      return NextResponse.json({ error: "weather_failed" }, { status: 200 });
    }
    const tempC = parseFloat(w.now.temp);
    if (Number.isNaN(tempC)) {
      return NextResponse.json({ error: "weather_failed" }, { status: 200 });
    }
    const humidity = parseFloat(w.now.humidity);
    const windSpeed = parseFloat(w.now.windSpeed);
    const data: WeatherResult = {
      tempC,
      humidity: Number.isNaN(humidity) ? 50 : humidity,
      windSpeed: Number.isNaN(windSpeed) ? 0 : windSpeed,
      text: w.now.text || "—",
      city: cityName,
    };
    cacheSet(weatherCache, ck, data, WEATHER_TTL, WEATHER_CACHE_MAX);
    return NextResponse.json(data);
  } catch (e) {
    // 闸门触顶不是"上游出错"，不该按 error 级别刷日志——它是预期内的自我保护
    if (e instanceof WeatherBudgetExhausted) {
      return NextResponse.json({ error: "weather_unavailable" }, { status: 200 });
    }
    // 上游错误细节（如 "qweather 401"）只进服务端日志，不透传给客户端，
    // 避免泄露上游状态/配置信息。客户端契约不变：body 带 error 字段即走降级链。
    console.error("[api/context] upstream error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "weather_unavailable" }, { status: 200 });
  }
}
