import { z } from "zod";
import { WeatherContextSchema, type WeatherContext } from "@/domain/schemas";
import { db } from "@/lib/storage/db";
import { providerSessionHeaders } from "@/lib/api/client-session";

export type CompetitionWeatherMode = "device-location" | "fixed-demo";
export type WeatherPermissionStatus = "not-requested" | "granted" | "denied" | "timeout" | "unavailable";
export type WeatherSource = "open-meteo" | "fixed-demo";
export type StoredWeatherState = {
  permission: WeatherPermissionStatus;
  source: WeatherSource | null;
  fetchedAt: number | null;
  weather: WeatherContext | null;
  errorCode: string | null;
};

const weatherStateKey = "weatherState";
const weatherCacheMaximumAgeMs = 6 * 60 * 60 * 1_000;
const defaultWeatherState: StoredWeatherState = { permission: "not-requested", source: null, fetchedAt: null, weather: null, errorCode: null };

const WeatherResponseSchema = z.object({
  weather: WeatherContextSchema,
  source: z.enum(["open-meteo", "fixed-demo"]),
}).passthrough();

const StoredWeatherStateSchema = z.object({
  permission: z.enum(["not-requested", "granted", "denied", "timeout", "unavailable"]),
  source: z.enum(["open-meteo", "fixed-demo"]).nullable(),
  fetchedAt: z.number().nullable(),
  weather: WeatherContextSchema.nullable(),
  errorCode: z.string().nullable(),
}).strict();

let pendingWeatherRequest: Promise<z.infer<typeof WeatherResponseSchema> | null> | null = null;

export function configuredWeatherMode(): CompetitionWeatherMode | "invalid" {
  const configured = process.env.NEXT_PUBLIC_WEATHER_MODE ?? "device-location";
  return configured === "device-location" || configured === "fixed-demo" ? configured : "invalid";
}

export async function getStoredWeatherState(): Promise<StoredWeatherState> {
  const value = (await db.appSettings.get(weatherStateKey))?.value;
  if (typeof value !== "string") return defaultWeatherState;
  try {
    const parsed = StoredWeatherStateSchema.safeParse(JSON.parse(value));
    if (!parsed.success) return defaultWeatherState;
    if (configuredWeatherMode() === "device-location" && parsed.data.source === "fixed-demo") {
      await saveWeatherState(defaultWeatherState);
      return defaultWeatherState;
    }
    return parsed.data;
  } catch {
    return defaultWeatherState;
  }
}

async function saveWeatherState(state: StoredWeatherState) {
  await db.appSettings.put({ key: weatherStateKey, value: JSON.stringify(state) });
}

function currentGeolocation() {
  return typeof navigator === "undefined" ? null : navigator.geolocation ?? null;
}

function locate(geolocation: Geolocation) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 7_000, maximumAge: 15 * 60 * 1_000 });
  });
}

function permissionFailure(error: unknown): Pick<StoredWeatherState, "permission" | "errorCode"> {
  const code = typeof error === "object" && error !== null && "code" in error ? Number((error as { code: unknown }).code) : 0;
  if (code === 1) return { permission: "denied", errorCode: "LOCATION_DENIED" };
  if (code === 3) return { permission: "timeout", errorCode: "LOCATION_TIMEOUT" };
  return { permission: "unavailable", errorCode: "LOCATION_UNAVAILABLE" };
}

async function runWeatherRequest(fetcher: typeof fetch, geolocation: Geolocation | null, force: boolean) {
  const mode = configuredWeatherMode();
  if (mode === "invalid") {
    const previous = await getStoredWeatherState();
    await saveWeatherState({ ...previous, permission: "unavailable", errorCode: "INVALID_WEATHER_MODE" });
    return null;
  }
  if (mode === "fixed-demo") {
    const response = await fetcher("/api/weather", { cache: "no-store" }).catch(() => null);
    const payload: unknown = response?.ok ? await response.json().catch(() => null) : null;
    const parsed = WeatherResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.source !== "fixed-demo") return null;
    await saveWeatherState({ permission: "not-requested", source: "fixed-demo", fetchedAt: Date.now(), weather: parsed.data.weather, errorCode: null });
    return parsed.data;
  }

  const previous = await getStoredWeatherState();
  if (!force && previous.permission === "denied") return null;
  if (!geolocation) {
    await saveWeatherState({ ...previous, permission: "unavailable", errorCode: "GEOLOCATION_UNAVAILABLE" });
    return null;
  }
  try {
    const position = await locate(geolocation);
    // City-level precision is sufficient for forecast selection and keeps exact
    // coordinates out of request URLs and access logs.
    const latitude = Math.round(position.coords.latitude * 100) / 100;
    const longitude = Math.round(position.coords.longitude * 100) / 100;
    const response = await fetcher("/api/weather", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...providerSessionHeaders() },
      body: JSON.stringify({ latitude, longitude }),
      cache: "no-store",
    });
    if (!response.ok) {
      await saveWeatherState({ ...previous, permission: "granted", errorCode: "WEATHER_PROVIDER_FAILED" });
      return null;
    }
    const payload: unknown = await response.json().catch(() => null);
    const parsed = WeatherResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.source !== "open-meteo") {
      await saveWeatherState({ ...previous, permission: "granted", errorCode: "INVALID_WEATHER_RESPONSE" });
      return null;
    }
    await saveWeatherState({ permission: "granted", source: "open-meteo", fetchedAt: Date.now(), weather: parsed.data.weather, errorCode: null });
    return parsed.data;
  } catch (error) {
    const failure = permissionFailure(error);
    await saveWeatherState({ ...previous, ...failure });
    return null;
  }
}

export async function fetchConfiguredWeather(fetcher: typeof fetch = fetch, geolocation: Geolocation | null = currentGeolocation(), options: { force?: boolean } = {}) {
  if (pendingWeatherRequest) return pendingWeatherRequest;
  pendingWeatherRequest = runWeatherRequest(fetcher, geolocation, options.force === true).finally(() => { pendingWeatherRequest = null; });
  return pendingWeatherRequest;
}

export function usableCachedWeather(state: StoredWeatherState, now = Date.now()) {
  if (!state.weather || state.fetchedAt === null || now - state.fetchedAt > weatherCacheMaximumAgeMs) return null;
  return state.weather;
}

export function resolveWeatherForSession(freshWeather: WeatherContext | null, sessionWeather: WeatherContext | null | undefined, cachedWeather: WeatherContext | null = null) {
  return freshWeather ?? sessionWeather ?? cachedWeather ?? null;
}
