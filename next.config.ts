import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // All three need real __dirname-relative filesystem access at runtime
  // (sharp's native binary, pdfkit's .afm font metrics under js/data/,
  // @contentauth/c2pa-node's prebuilt index.node) — bundling any of them
  // through webpack/Turbopack breaks that resolution. pdfkit already hit
  // this as an ENOENT in deployment; c2pa-node ships the same class of
  // native binary and would fail the same way if left bundled.
  serverExternalPackages: ['sharp', 'pdfkit', '@contentauth/c2pa-node'],
}

export default nextConfig
