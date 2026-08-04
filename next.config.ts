import type { NextConfig } from "next";

const supabaseOrigin = (() => {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!configured) return "";
  try {
    return new URL(configured).origin;
  } catch {
    return "";
  }
})();

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "media-src 'self' blob:",
      `connect-src 'self' https://api.openai.com wss://api.openai.com${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
      "worker-src 'self' blob:",
      "font-src 'self' data:",
      "manifest-src 'self'",
    ].join("; "),
  },
];

const sharpRuntimeFiles = [
  "node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/**/*",
  "node_modules/.pnpm/@img+sharp-linux-x64@0.34.5/node_modules/@img/sharp-linux-x64/**/*",
  "node_modules/.pnpm/@img+sharp-libvips-linux-x64@1.2.4/node_modules/@img/sharp-libvips-linux-x64/**/*",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  turbopack: {
    resolveAlias: process.env.NODE_ENV === "production"
      ? {
          "@/components/motion/motion-review-client": "./src/components/motion/motion-review-disabled.tsx",
          "@/components/calibration/calibration-lab": "./src/components/calibration/calibration-lab-disabled.tsx",
        }
      : {},
  },
  outputFileTracingIncludes: {
    "/api/wardrobe/process": sharpRuntimeFiles,
    "/api/outfits/rank": sharpRuntimeFiles,
    "/api/health/image": sharpRuntimeFiles,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
