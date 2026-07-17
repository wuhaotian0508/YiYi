import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "YiYi",
    short_name: "YiYi",
    description: "A continuous voice-first outfit assistant.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [{ src: "/brand/yiyi-mark.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
