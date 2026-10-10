/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Dev and production builds use separate folders, so running `npm run dev`
  // never corrupts a production build (or vice versa) - e.g. "Cannot find module './294.js'".
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
};
export default nextConfig;
