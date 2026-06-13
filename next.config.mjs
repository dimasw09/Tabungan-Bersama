/** @type {import('next').NextConfig} */
const nextConfig = {
  // TypeScript tetap wajib lewat script `npm run typecheck` sebelum `next build`.
  // Next.js type worker dinonaktifkan agar build stabil di CI/container tertentu.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' }
    ]
  }
};

export default nextConfig;
