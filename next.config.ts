import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        // Page responses replace this with the nonce policy in proxy.ts.
        { key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
      ],
    }]
  },
  // All three need real __dirname-relative filesystem access at runtime
  // (sharp's native binary, pdfkit's .afm font metrics under js/data/,
  // @contentauth/c2pa-node's prebuilt index.node) — bundling any of them
  // through webpack/Turbopack breaks that resolution. pdfkit already hit
  // this as an ENOENT in deployment; c2pa-node ships the same class of
  // native binary and would fail the same way if left bundled.
  serverExternalPackages: ['sharp', 'pdfkit', '@contentauth/c2pa-node'],
}

export default nextConfig
