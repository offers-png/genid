import Link from 'next/link'

export const metadata = {
  title: 'Chrome Extension — GENID Protocol',
  description: 'Right-click any image to certify it with GenID — download the Chrome extension.',
}

export default function ExtensionPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-2">GenID Chrome Extension</h1>
        <p className="text-gray-400">
          Right-click any image on any website and run it through the full GenID certification
          pipeline — no downloading, uploading, or switching tabs required.
        </p>
      </div>

      {/* Download */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs text-gray-500 font-mono mb-1">VERSION 1.0.0</div>
            <div className="text-lg font-semibold text-white">genid-chrome-extension.zip</div>
          </div>
          <a
            href="/downloads/genid-chrome-extension.zip"
            download
            className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-3 rounded-lg font-medium transition-colors inline-block whitespace-nowrap"
          >
            Download for Chrome
          </a>
        </div>
        <p className="text-xs text-gray-500 mt-4">
          Not on the Chrome Web Store yet — see install instructions below. You&apos;ll also need a
          GenID API key (
          <Link href="/dashboard/api-keys" className="text-violet-400 hover:text-violet-300">
            generate one in your dashboard
          </Link>
          ), from a Stripe-identity-verified GENID.
        </p>
      </div>

      {/* How it works */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">How it works</h2>
        <ol className="space-y-3 text-sm text-gray-300">
          <li className="flex gap-3">
            <span className="flex-none w-6 h-6 rounded-full bg-violet-900/50 border border-violet-800 text-violet-400 text-xs font-medium flex items-center justify-center">1</span>
            <span>Right-click any image on any webpage.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-none w-6 h-6 rounded-full bg-violet-900/50 border border-violet-800 text-violet-400 text-xs font-medium flex items-center justify-center">2</span>
            <span>
              Click <strong className="text-white">&ldquo;Certify with GenID&rdquo;</strong> in the context menu.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex-none w-6 h-6 rounded-full bg-violet-900/50 border border-violet-800 text-violet-400 text-xs font-medium flex items-center justify-center">3</span>
            <span>
              The extension runs the image through the full pipeline — hash chain, Polygon anchor,
              C2PA/CAWG manifest — and the signed certificate PDF downloads automatically.
            </span>
          </li>
        </ol>
      </div>

      {/* Install instructions */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">Install instructions</h2>
        <ol className="space-y-3 text-sm text-gray-300 list-decimal list-inside">
          <li>Download the zip above and unzip it somewhere you won&apos;t move or delete it.</li>
          <li>
            Open{' '}
            <code className="bg-gray-800 text-violet-300 px-1.5 py-0.5 rounded text-xs">chrome://extensions</code>{' '}
            in Chrome.
          </li>
          <li>Enable <strong className="text-white">Developer mode</strong> (top-right toggle).</li>
          <li>
            Click <strong className="text-white">Load unpacked</strong> and select the unzipped folder.
          </li>
          <li>
            Click the GenID icon in your toolbar → <strong className="text-white">Settings</strong> → paste
            in your API key.
          </li>
        </ol>
        <p className="text-xs text-gray-500 mt-4">
          &ldquo;Not in the Chrome Web Store&rdquo; is why Developer mode is needed — Chrome only lets
          unpacked extensions load that way. Publishing to the Web Store (removing this step entirely)
          is planned once the extension has real usage to justify it.
        </p>
      </div>

      <div className="text-center">
        <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-300">
          ← Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
