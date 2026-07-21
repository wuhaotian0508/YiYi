import { z } from "zod";
import { WeatherContextSchema } from "@/domain/schemas";
import { logApiDiagnostic, safeErrorMetadata } from "@/lib/api/diagnostics";
import { takeRateLimit } from "@/lib/api/rate-limit";
import { apiError, noStoreJson } from "@/lib/api/responses";

export const runtime = "nodejs";

const coordinate = (minimum: number, maximum: number) => z.coerce.number().finite().min(minimum).max(maximum);
const LocationSchema = z.object({ latitude: coordinate(-90, 90), longitude: coordinate(-180, 180) }).strict();
const ProviderSchema = z.object({
  timezone: z.string().min(1),
  utc_offset_seconds: z.number().int().min(-86_400).max(86_400),
  current: z.object({
    time: z.number().int().nonnegative(),
    interval: z.number().int().positive().optional(),
    temperature_2m: z.number().finite(),
    weather_code: z.number().int().min(0).max(99),
  }).strict().optional(),
  daily: z.object({
    time: z.array(z.number().int().nonnegative()).min(1),
    temperature_2m_max: z.array(z.number().finite()).min(1),
    temperature_2m_min: z.array(z.number().finite()).min(1),
  }).strict().optional(),
  hourly: z.object({
    time: z.array(z.number().int().nonnegative()).min(1),
    temperature_2m: z.array(z.number().finite()).min(1).optional(),
    apparent_temperature: z.array(z.number().finite()).min(1),
    precipitation_probability: z.array(z.number().finite()).min(1),
    weather_code: z.array(z.number().int().min(0).max(99)).min(1).optional(),
    wind_speed_10m: z.array(z.number().finite()).min(1),
  }).strict(),
}).superRefine((provider, context) => {
  const expected = provider.hourly.time.length;
  for (const field of ["temperature_2m", "apparent_temperature", "precipitation_probability", "weather_code", "wind_speed_10m"] as const) {
    const values = provider.hourly[field];
    if (values && values.length !== expected) context.addIssue({ code: "custom", path: ["hourly", field], message: "Hourly arrays must have equal lengths" });
  }
  if (provider.daily && (provider.daily.temperature_2m_max.length !== provider.daily.time.length || provider.daily.temperature_2m_min.length !== provider.daily.time.length)) {
    context.addIssue({ code: "custom", path: ["daily"], message: "Daily arrays must have equal lengths" });
  }
});

function weatherSummary(code: number, expectedRain: boolean, windy: boolean) {
  if (code >= 95) return "Thunderstorms";
  if (code >= 71) return "Snow";
  if (code >= 51 || expectedRain) return windy ? "Rain and wind" : "Light rain possible";
  if (code >= 45) return "Foggy";
  if (code >= 2) return windy ? "Cloudy and windy" : "Partly cloudy";
  return windy ? "Clear and windy" : "Clear";
}

function fixedDemoWeather() {
  const now = Date.now();
  return WeatherContextSchema.parse({
    minApparentTempC: 12,
    maxApparentTempC: 17,
    precipitationProbability: 42,
    expectedRain: true,
    windy: false,
    summary: "Light rain",
    sourceTimestamp: now,
    currentTemperatureC: 14,
    currentWeatherCode: 61,
    dailyHighC: 17,
    dailyLowC: 12,
    hourly: Array.from({ length: 12 }, (_, index) => ({ timestamp: now + index * 3_600_000, temperatureC: 14 + Math.sin(index / 3) * 2, weatherCode: 61, precipitationProbability: 42 })),
    timezone: "America/Los_Angeles",
    locationLabel: "Demo location",
  });
}

async function liveWeather(request: Request, location: z.infer<typeof LocationSchema>, requestId: string) {
  const routeStartedAt = Date.now();
  const rateLimit = await takeRateLimit(request, "weather", 240);
  if (!rateLimit.available) return apiError(requestId, 503, "RATE_LIMIT_UNAVAILABLE", "Weather is temporarily unavailable.", true);
  if (!rateLimit.allowed) return apiError(requestId, 429, "RATE_LIMITED", "Weather was refreshed too often. Try again shortly.", true, { "Retry-After": String(rateLimit.retryAfterSeconds) });
  try {
    const providerUrl = new URL("https://api.open-meteo.com/v1/forecast");
    providerUrl.search = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current: "temperature_2m,weather_code",
      hourly: "temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m",
      daily: "temperature_2m_max,temperature_2m_min",
      forecast_days: "2",
      timezone: "auto",
      timeformat: "unixtime",
    }).toString();
    const provider = await fetch(providerUrl, { next: { revalidate: 900 }, signal: AbortSignal.timeout(8_000) });
    if (!provider.ok) throw Object.assign(new Error("Weather provider failed"), { status: provider.status });
    const providerData = ProviderSchema.parse(await provider.json() as unknown);
    const firstFutureIndex = providerData.hourly.time.findIndex((timestamp) => timestamp >= Math.floor(Date.now() / 1_000));
    if (firstFutureIndex < 0 || providerData.hourly.time.length - firstFutureIndex < 12) throw new Error("Insufficient future weather window");
    const indices = Array.from({ length: 12 }, (_, offset) => firstFutureIndex + offset);
    const apparentTemperatures = indices.map((index) => providerData.hourly.apparent_temperature[index]);
    const temperatures = indices.map((index) => providerData.hourly.temperature_2m?.[index] ?? providerData.hourly.apparent_temperature[index]);
    const rain = indices.map((index) => providerData.hourly.precipitation_probability[index]);
    const weatherCodes = indices.map((index) => providerData.hourly.weather_code?.[index] ?? providerData.current?.weather_code ?? 0);
    const wind = indices.map((index) => providerData.hourly.wind_speed_10m[index]);
    const maximumRain = Math.max(...rain);
    const windy = Math.max(...wind) >= 28;
    const expectedRain = maximumRain >= 40;
    const currentWeatherCode = providerData.current?.weather_code ?? weatherCodes[0];
    const weather = WeatherContextSchema.parse({
      minApparentTempC: Math.min(...apparentTemperatures),
      maxApparentTempC: Math.max(...apparentTemperatures),
      precipitationProbability: maximumRain,
      expectedRain,
      windy,
      summary: weatherSummary(currentWeatherCode, expectedRain, windy),
      sourceTimestamp: (providerData.current?.time ?? providerData.hourly.time[firstFutureIndex]) * 1_000,
      currentTemperatureC: providerData.current?.temperature_2m ?? temperatures[0],
      currentWeatherCode,
      dailyHighC: providerData.daily?.temperature_2m_max[0] ?? Math.max(...temperatures),
      dailyLowC: providerData.daily?.temperature_2m_min[0] ?? Math.min(...temperatures),
      hourly: indices.map((index, offset) => ({ timestamp: providerData.hourly.time[index] * 1_000, temperatureC: temperatures[offset], weatherCode: weatherCodes[offset], precipitationProbability: rain[offset] })),
      timezone: providerData.timezone,
      // Open-Meteo forecast returns an IANA time zone, not a reverse-geocoded city.
      // Treating its representative city as the user's city (for example San
      // Francisco -> America/Los_Angeles) would present false location data.
      locationLabel: "Current area",
    });
    logApiDiagnostic({ requestId, route: "/api/weather", provider: "open-meteo", outcome: "success", httpStatus: 200, durationMs: Date.now() - routeStartedAt, providerStage: "forecast" });
    return noStoreJson({ requestId, weather, source: "open-meteo" });
  } catch (error) {
    logApiDiagnostic({ requestId, route: "/api/weather", provider: "open-meteo", outcome: "error", ...safeErrorMetadata(error), durationMs: Date.now() - routeStartedAt, errorCode: "WEATHER_FAILED", providerStage: "forecast" });
    return apiError(requestId, 502, "WEATHER_FAILED", "Weather is unavailable.", true);
  }
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const hasLatitude = url.searchParams.has("latitude");
  const hasLongitude = url.searchParams.has("longitude");
  if (!hasLatitude && !hasLongitude) return noStoreJson({ requestId, weather: fixedDemoWeather(), source: "fixed-demo" });
  if (hasLatitude !== hasLongitude) return apiError(requestId, 400, "INVALID_LOCATION", "Choose a valid location.");
  const location = LocationSchema.safeParse({ latitude: url.searchParams.get("latitude"), longitude: url.searchParams.get("longitude") });
  if (!location.success) return apiError(requestId, 400, "INVALID_LOCATION", "Choose a valid location.");
  return liveWeather(request, location.data, requestId);
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  let body: unknown;
  try { body = await request.json(); }
  catch { return apiError(requestId, 400, "INVALID_JSON", "The location request was invalid."); }
  const location = LocationSchema.safeParse(body);
  if (!location.success) return apiError(requestId, 400, "INVALID_LOCATION", "Choose a valid location.");
  return liveWeather(request, location.data, requestId);
}
