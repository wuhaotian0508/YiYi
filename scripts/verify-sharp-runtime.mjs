import sharp from "sharp";

const output = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).webp().toBuffer();
const metadata = await sharp(output, { limitInputPixels: 4, failOn: "warning" }).metadata();
if (metadata.format !== "webp" || metadata.width !== 2 || metadata.height !== 2 || (metadata.pages ?? 1) !== 1) {
  throw new Error("Sharp WebP runtime smoke failed.");
}
console.log(JSON.stringify({ ready: true, sharp: sharp.versions.sharp, vips: sharp.versions.vips, bytes: output.byteLength }));
