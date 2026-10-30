import { resolve } from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(__dirname, "../.."),
  ...(process.env.TASTIP_E2E_SERVER === "1"
    ? { distDir: ".next-e2e", typescript: { tsconfigPath: "tsconfig.e2e.json" } }
    : process.env.TASTIP_PREVIEW_SERVER === "1"
      ? { distDir: ".next-preview", typescript: { tsconfigPath: "tsconfig.preview.json" } }
      : {}),
  poweredByHeader: false,
  devIndicators: false,
  transpilePackages: ["@tastip/domain", "@tastip/providers", "@tastip/ui", "@tastip/scene"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
