import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "GCCC Publishing", template: "%s · GCCC Publishing" },
  description: "Glory Realms Ministries Publishing: every message preserved, transcribed and documented.",
  robots: { index: false, follow: false },
  icons: { icon: "/brand/gccc-mark.png" },
};

export const viewport: Viewport = { themeColor: "#141416" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = (await cookies()).get("theme")?.value === "dark" ? "dark" : "light";
  return (
    <html lang="en" data-theme={theme} className="antialiased">
      <head>
        <link rel="preload" href="/fonts/Poppins-400.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/ClashDisplay-600.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
