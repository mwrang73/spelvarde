/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Fixturläget (lib/deps.ts, bara lokalt) läser filer via process.cwd().
    outputFileTracingExcludes: { "*": ["./test/**", "./.local-db/**", "./docs/**", "./*.pdf", "./*.docx"] },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
