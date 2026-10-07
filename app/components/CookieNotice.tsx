'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const DISMISSED_KEY = 'genid_cookie_notice_dismissed'

// GenID sets only two cookies, both strictly necessary for the service to
// function (a sign-in session cookie and a CSRF token) — no analytics or
// advertising cookies exist in this product today, so there's no
// accept/reject CHOICE to actually offer here. This is a notice, not a
// consent banner: GDPR/ePrivacy don't require consent for strictly
// necessary cookies, so presenting a fake "Accept/Reject" pair would be
// misleading about what's actually happening. If non-essential cookies are
// ever added, this needs to become a real consent banner first.
export default function CookieNotice() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let dismissed = false
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === 'true'
    } catch {
      // Private browsing / blocked storage — fail open to not showing a
      // banner that can never be dismissed.
    }
    // localStorage doesn't exist during SSR, so `visible` must start false
    // and this effect is the only point that can read it — there's no
    // render-time alternative that stays hydration-safe here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(!dismissed)
  }, [])

  function dismiss() {
    setVisible(false)
    try {
      localStorage.setItem(DISMISSED_KEY, 'true')
    } catch {
      // Best-effort — if storage is blocked, the notice just reappears next
      // visit, which is harmless.
    }
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 border-t border-gray-800 bg-gray-950/95 backdrop-blur">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-gray-400">
          GenID uses only essential cookies required for sign-in and security — no tracking or analytics cookies.
          See our <Link href="/privacy" className="text-violet-400 hover:text-violet-300">Privacy Policy</Link>.
        </p>
        <button
          onClick={dismiss}
          className="flex-none bg-violet-600 hover:bg-violet-500 text-white px-4 py-1.5 rounded-md text-xs font-medium transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
