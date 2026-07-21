export class ImageRuntimeUnavailableError extends Error {
  constructor() {
    super("The server image runtime is unavailable.");
    this.name = "ImageRuntimeUnavailableError";
  }
}

type SharpFactory = typeof import("sharp");

let sharpPromise: Promise<SharpFactory> | null = null;

export async function loadSharp() {
  sharpPromise ??= import("sharp").then((module) => {
    const loaded = module as unknown as { default?: SharpFactory };
    return loaded.default ?? module as unknown as SharpFactory;
  }).catch(() => {
    sharpPromise = null;
    throw new ImageRuntimeUnavailableError();
  });
  return sharpPromise;
}

export function isImageRuntimeUnavailable(error: unknown): error is ImageRuntimeUnavailableError {
  return error instanceof ImageRuntimeUnavailableError;
}

export async function sharpRuntimeSmoke() {
  const sharp = await loadSharp();
  const output = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
    .webp({ quality: 80 })
    .toBuffer();
  const metadata = await sharp(output, { limitInputPixels: 4, failOn: "warning" }).metadata();
  if (metadata.format !== "webp" || metadata.width !== 2 || metadata.height !== 2 || (metadata.pages ?? 1) !== 1) throw new ImageRuntimeUnavailableError();
  return { format: metadata.format, width: metadata.width, height: metadata.height, bytes: output.byteLength, sharp: sharp.versions.sharp, vips: sharp.versions.vips };
}
