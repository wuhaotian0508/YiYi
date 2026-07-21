// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/storage/db";
import { fetchConfiguredWeather, getStoredWeatherState, resolveWeatherForSession, usableCachedWeather } from "@/lib/weather/client";

const weather = { minApparentTempC: 10, maxApparentTempC: 16, precipitationProbability: 15, expectedRain: false, windy: false, summary: "Cool and dry", sourceTimestamp: 1_800_000_000_000 };

function geolocation(result: "allow" | "deny" | "timeout") {
  return {
    getCurrentPosition(success: PositionCallback, failure: PositionErrorCallback) {
      if (result === "allow") success({ coords: { latitude: 37.77, longitude: -122.42 } } as GeolocationPosition);
      else failure({ code: result === "deny" ? 1 : 3 } as GeolocationPositionError);
    },
  } as Geolocation;
}

describe("device weather client", () => {
  beforeEach(async () => {
    vi.stubEnv("NEXT_PUBLIC_WEATHER_MODE", "device-location");
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await db.delete();
  });

  it("requests low-precision device location, fetches live weather, and never stores coordinates", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ weather, source: "open-meteo" }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

    const result = await fetchConfiguredWeather(fetcher, geolocation("allow"));

    expect(result).toMatchObject({ weather, source: "open-meteo" });
    expect(String(vi.mocked(fetcher).mock.calls[0]?.[0])).toBe("/api/weather");
    expect(vi.mocked(fetcher).mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body))).toEqual({ latitude: 37.77, longitude: -122.42 });
    const stored = await db.appSettings.get("weatherState");
    expect(String(stored?.value)).not.toContain("37.77");
    expect(String(stored?.value)).not.toContain("-122.42");
    expect(await getStoredWeatherState()).toMatchObject({ permission: "granted", source: "open-meteo", weather });
  });

  it("discards legacy Demo weather when the configured mode is device location", async () => {
    await db.appSettings.put({ key: "weatherState", value: JSON.stringify({ permission: "not-requested", source: "fixed-demo", fetchedAt: Date.now(), weather: { ...weather, summary: "58° · Light rain" }, errorCode: null }) });
    expect(await getStoredWeatherState()).toMatchObject({ source: null, weather: null, permission: "not-requested" });
  });

  it("records denial without calling the provider or silently substituting Demo", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(await fetchConfiguredWeather(fetcher, geolocation("deny"))).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await getStoredWeatherState()).toMatchObject({ permission: "denied", source: null, weather: null, errorCode: "LOCATION_DENIED" });
  });

  it("resolves fresh, then session, then valid cache, then unavailable", () => {
    const fresh = { ...weather, summary: "Fresh" };
    const session = { ...weather, summary: "Session" };
    const cached = { ...weather, summary: "Cached" };
    expect(resolveWeatherForSession(fresh, session, cached)).toBe(fresh);
    expect(resolveWeatherForSession(null, session, cached)).toBe(session);
    expect(resolveWeatherForSession(null, null, cached)).toBe(cached);
    expect(resolveWeatherForSession(null, null, null)).toBeNull();
    expect(usableCachedWeather({ permission: "timeout", source: "open-meteo", fetchedAt: 1_000, weather: cached, errorCode: "LOCATION_TIMEOUT" }, 2_000)).toBe(cached);
    expect(usableCachedWeather({ permission: "timeout", source: "open-meteo", fetchedAt: 1_000, weather: cached, errorCode: "LOCATION_TIMEOUT" }, 7 * 60 * 60 * 1_000)).toBeNull();
  });
});
