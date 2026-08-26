/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // next lint only covers app/pages/components/lib by default — sim/ would be
  // skipped entirely. Set here so `next build` uses the same list as `npm run lint`.
  eslint: {
    dirs: ["ai", "app", "components", "lib", "sim"],
  },
};

export default nextConfig;
