// 情境感知：服务端代理和风天气（保护 key），带 30 分钟网格缓存，失败优雅降级
import { NextRequest, NextResponse } from "next/server";
import { allow, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";

const HOST = process.env.QWEATHER_HOST;
const KEY = process.env.QWEATHER_KEY;

interface CacheEntry {
  at: number;
  data: WeatherResult;
}
interface WeatherResult {
  tempC: number;
  humidity: number;
  windSpeed: number;
  text: string;
  city: string;
  approximate?: boolean;
}

const cache = new Map<string, CacheEntry>();
const TTL = 30 * 60 * 1000;

function gridKey(lon: number, lat: number) {
  return `${lon.toFixed(2)},${lat.toFixed(2)}@${Math.floor(Date.now() / TTL)}`;
}

async function qweather(path: string, params: Record<string, string>) {
  const url = new URL(`https://${HOST}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", KEY ?? "");
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
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
    return NextResponse.json({ error: "rate_limited" }, { status: 200 });
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
      const geo = await qweather("/geo/v2/city/lookup", { location: city });
      const loc = geo?.location?.[0];
      if (!loc) return NextResponse.json({ error: "city_not_found" }, { status: 200 });
      lonNum = parseFloat(loc.lon);
      latNum = parseFloat(loc.lat);
      cityName = loc.name;
    } else {
      return NextResponse.json({ error: "missing_location" }, { status: 400 });
    }

    const ck = gridKey(lonNum, latNum);
    const cached = cache.get(ck);
    if (cached) {
      const data = cityName ? { ...cached.data, city: cityName } : cached.data;
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
    cache.set(ck, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: "weather_error", message: e instanceof Error ? e.message : "unknown" },
      { status: 200 }
    );
  }
}
