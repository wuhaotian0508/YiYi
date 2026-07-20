import { z } from "zod";
import { WeatherContextSchema, type WeatherContext } from "@/domain/schemas";

export type CompetitionWeatherMode = "fixed-demo";

const FixedDemoResponseSchema = z.object({
  weather: WeatherContextSchema,
  source: z.literal("fixed-demo"),
}).passthrough();

export function configuredWeatherMode(): CompetitionWeatherMode | "invalid" {
  const configured = process.env.NEXT_PUBLIC_WEATHER_MODE ?? "fixed-demo";
  return configured === "fixed-demo" ? configured : "invalid";
}

export async function fetchConfiguredWeather(fetcher: typeof fetch = fetch) {
  if (configuredWeatherMode() !== "fixed-demo") return null;
  const response = await fetcher("/api/weather", { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return null;
  const payload: unknown = await response.json().catch(() => null);
  const parsed = FixedDemoResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export function resolveWeatherForSession(freshWeather: WeatherContext | null, sessionWeather: WeatherContext | null | undefined) {
  return freshWeather ?? sessionWeather ?? null;
}
