import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg cuts sermon audio into parts on the server; ship its binary with the routes
  // that run the transcription queue.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/jobs/run": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/cron/work": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  // Private to the Publishing team: keep every page out of search results, and the usual
  // browser protections.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/", destination: "/library", permanent: false },
      // Speakers moved into Settings.
      { source: "/speakers", destination: "/settings/speakers", permanent: true },
      // Needs details became Check dates.
      { source: "/needs-details", destination: "/check-dates", permanent: true },
    ];
  },
};

export default nextConfig;
