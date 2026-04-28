import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'GENID Protocol',
  description: 'Cryptographic AI Content Identity — Patent Pending',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={geist.className}>
      <body className="bg-gray-950 text-gray-100 min-h-screen flex flex-col">
        <nav className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <a href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 bg-violet-500 rounded-md flex items-center justify-center text-xs font-bold text-white">G</div>
              <span className="font-semibold tracking-tight">GENID Protocol</span>
              <span className="text-xs text-violet-400 border border-violet-800 rounded px-1.5 py-0.5 ml-1">Patent Pending</span>
            </a>
            <div className="flex items-center gap-6 text-sm text-gray-400">
              <a href="/verify" className="hover:text-white transition-colors">Verify</a>
              <a href="/embed" className="hover:text-white transition-colors">Stamp</a>
              <a href="/dashboard" className="hover:text-white transition-colors">Dashboard</a>
              <a href="/register" className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-1.5 rounded-md transition-colors text-sm">
                Get GENID
              </a>
            </div>
          </div>
        </nav>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-gray-800 py-8 text-center text-xs text-gray-600">
          GENID Protocol &copy; {new Date().getFullYear()} DealDily &mdash; Patent Pending &mdash; Confidential
        </footer>
      </body>
    </html>
  )
}
