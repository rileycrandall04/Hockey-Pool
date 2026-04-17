/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "assets.nhle.com" },
      { protocol: "https", hostname: "cms.nhl.bamgrid.com" },
    ],
  },
};

export default nextConfig;
// rebuild 2
