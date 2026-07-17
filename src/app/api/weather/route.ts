import { z } from "zod";
import { WeatherContextSchema } from "@/domain/schemas";
import { apiError, noStoreJson } from "@/lib/api/responses";

export const runtime = "nodejs";
const QuerySchema = z.object({ latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180) });

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  if (process.env.NEXT_PUBLIC_USE_FIXED_DEMO_WEATHER !== "false") return noStoreJson({ requestId, weather: { minApparentTempC: 12, maxApparentTempC: 17, precipitationProbability: 42, expectedRain: true, windy: false, summary: "58° · Light rain", sourceTimestamp: Date.now() } });
  const url = new URL(request.url);
  const query = QuerySchema.safeParse({ latitude: url.searchParams.get("latitude"), longitude: url.searchParams.get("longitude") });
  if (!query.success) return apiError(requestId, 400, "INVALID_LOCATION", "Choose a valid location.");
  try {
    const providerUrl = new URL("https://api.open-meteo.com/v1/forecast");
    providerUrl.search = new URLSearchParams({ latitude: String(query.data.latitude), longitude: String(query.data.longitude), hourly: "apparent_temperature,precipitation_probability,wind_speed_10m", forecast_days: "1", timezone: "auto" }).toString();
    const provider = await fetch(providerUrl, { next: { revalidate: 900 }, signal: AbortSignal.timeout(8_000) });
    if (!provider.ok) throw new Error("weather provider failed");
    const json: unknown = await provider.json();
    const ProviderSchema = z.object({ hourly: z.object({ apparent_temperature: z.array(z.number()), precipitation_probability: z.array(z.number()), wind_speed_10m: z.array(z.number()) }) });
    const hourly = ProviderSchema.parse(json).hourly;
    const temperatures = hourly.apparent_temperature.slice(0, 12);
    const rain = hourly.precipitation_probability.slice(0, 12);
    const wind = hourly.wind_speed_10m.slice(0, 12);
    const weather = WeatherContextSchema.parse({ minApparentTempC: Math.min(...temperatures), maxApparentTempC: Math.max(...temperatures), precipitationProbability: Math.max(...rain), expectedRain: Math.max(...rain) >= 40, windy: Math.max(...wind) >= 28, summary: Math.max(...rain) >= 40 ? "Light rain possible" : "Mild and dry", sourceTimestamp: Date.now() });
    return noStoreJson({ requestId, weather });
  } catch {
    return apiError(requestId, 502, "WEATHER_FAILED", "Weather is unavailable.", true);
  }
}
