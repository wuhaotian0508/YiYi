import { z } from "zod";
import { WeatherContextSchema } from "@/domain/schemas";
import { apiError, noStoreJson } from "@/lib/api/responses";

export const runtime = "nodejs";
const coordinate = (minimum: number, maximum: number) => z.string().trim().min(1)
  .refine((value) => Number.isFinite(Number(value)))
  .transform(Number)
  .pipe(z.number().min(minimum).max(maximum));
const QuerySchema = z.object({ latitude: coordinate(-90, 90), longitude: coordinate(-180, 180) }).strict();
const ProviderSchema = z.object({
  timezone: z.string().min(1),
  utc_offset_seconds: z.number().int().min(-86_400).max(86_400),
  hourly: z.object({
    time: z.array(z.number().int().nonnegative()).min(1),
    apparent_temperature: z.array(z.number().finite()).min(1),
    precipitation_probability: z.array(z.number().finite()).min(1),
    wind_speed_10m: z.array(z.number().finite()).min(1),
  }).strict(),
}).superRefine((provider, context) => {
  const expected = provider.hourly.time.length;
  for (const field of ["apparent_temperature", "precipitation_probability", "wind_speed_10m"] as const) {
    if (provider.hourly[field].length !== expected) context.addIssue({ code: "custom", path: ["hourly", field], message: "Hourly arrays must have equal lengths" });
  }
});

function fixedDemoWeather() {
  return WeatherContextSchema.parse({ minApparentTempC: 12, maxApparentTempC: 17, precipitationProbability: 42, expectedRain: true, windy: false, summary: "58° · Light rain", sourceTimestamp: Date.now() });
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const hasLatitude = url.searchParams.has("latitude");
  const hasLongitude = url.searchParams.has("longitude");
  if (!hasLatitude && !hasLongitude) return noStoreJson({ requestId, weather: fixedDemoWeather(), source: "fixed-demo" });
  if (hasLatitude !== hasLongitude) return apiError(requestId, 400, "INVALID_LOCATION", "Choose a valid location.");
  const query = QuerySchema.safeParse({ latitude: url.searchParams.get("latitude"), longitude: url.searchParams.get("longitude") });
  if (!query.success) return apiError(requestId, 400, "INVALID_LOCATION", "Choose a valid location.");
  try {
    const providerUrl = new URL("https://api.open-meteo.com/v1/forecast");
    providerUrl.search = new URLSearchParams({ latitude: String(query.data.latitude), longitude: String(query.data.longitude), hourly: "apparent_temperature,precipitation_probability,wind_speed_10m", forecast_days: "2", timezone: "auto", timeformat: "unixtime" }).toString();
    const provider = await fetch(providerUrl, { next: { revalidate: 900 }, signal: AbortSignal.timeout(8_000) });
    if (!provider.ok) throw new Error("weather provider failed");
    const json: unknown = await provider.json();
    const providerData = ProviderSchema.parse(json);
    const firstFutureIndex = providerData.hourly.time.findIndex((timestamp) => timestamp >= Math.floor(Date.now() / 1_000));
    if (firstFutureIndex < 0 || providerData.hourly.time.length - firstFutureIndex < 12) throw new Error("insufficient future weather window");
    const indices = Array.from({ length: 12 }, (_, offset) => firstFutureIndex + offset);
    const temperatures = indices.map((index) => providerData.hourly.apparent_temperature[index]);
    const rain = indices.map((index) => providerData.hourly.precipitation_probability[index]);
    const wind = indices.map((index) => providerData.hourly.wind_speed_10m[index]);
    const maximumRain = Math.max(...rain);
    const weather = WeatherContextSchema.parse({ minApparentTempC: Math.min(...temperatures), maxApparentTempC: Math.max(...temperatures), precipitationProbability: maximumRain, expectedRain: maximumRain >= 40, windy: Math.max(...wind) >= 28, summary: maximumRain >= 40 ? "Light rain possible" : "Mild and dry", sourceTimestamp: providerData.hourly.time[firstFutureIndex] * 1_000 });
    return noStoreJson({ requestId, weather, source: "open-meteo" });
  } catch {
    return apiError(requestId, 502, "WEATHER_FAILED", "Weather is unavailable.", true);
  }
}
