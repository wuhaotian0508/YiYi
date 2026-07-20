import type { Metadata, Viewport } from "next";
import { YiYiMotionProvider } from "@/components/motion/motion-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "YiYi — Your voice outfit assistant",
  description: "Tell YiYi about your day. YiYi will choose the outfit.",
  applicationName: "YiYi",
  appleWebApp: { capable: true, title: "YiYi", statusBarStyle: "default" },
  icons: { icon: "/brand/yiyi-mark.svg", apple: "/brand/yiyi-mark.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><YiYiMotionProvider>{children}</YiYiMotionProvider></body></html>;
}
