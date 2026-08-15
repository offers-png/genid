import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Both need real __dirname-relative filesystem access at runtime (sharp's
  // native binary, pdfkit's .afm font metrics under js/data/) — bundling
  // either through webpack/Turbopack breaks that resolution and pdfkit fails
  // with ENOENT on its font files in deployment.
  serverExternalPackages: ['sharp', 'pdfkit'],
}

export default nextConfig
