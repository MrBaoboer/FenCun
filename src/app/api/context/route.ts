// 情境感知：服务端代理和风天气（保护 key），带 30 分钟网格缓存，失败优雅降级
import { NextRequest, NextResponse } from "next/server";
import { allow, clientKey } from "@/lib/ratelimit";

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

async function qweather(path: string, params: Record<string, string>) {
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
      if (Number.isNaN(lonNum) || Number.isNaN(latNum)) {
        return NextResponse.json({ error: "bad_coords" }, { status: 400 });
      }
      cityName = "";
    } else if (city) {
      const geoHit = cacheGet(geoCache, city, GEO_TTL);
      if (geoHit) {
        lonNum = geoHit.lon;
        latNum = geoHit.lat;
        cityName = geoHit.name;
      } else {
        const geo = await qweather("/geo/v2/city/lookup", { location: city });
        const loc = geo?.location?.[0];
        if (!loc) return NextResponse.json({ error: "city_not_found" }, { status: 200 });
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
      } catch {
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
    // 上游错误细节（如 "qweather 401"）只进服务端日志，不透传给客户端，
    // 避免泄露上游状态/配置信息。客户端契约不变：body 带 error 字段即走降级链。
    console.error("[api/context] upstream error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "weather_unavailable" }, { status: 200 });
  }
}
