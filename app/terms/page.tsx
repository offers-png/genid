import Link from 'next/link'

export const metadata = {
  title: 'Terms of Service — GENID Protocol',
  description: 'The terms that govern use of GenID.',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-4">
      <h2 className="text-lg font-semibold text-white mb-3">{title}</h2>
      <div className="text-sm text-gray-300 space-y-3 leading-relaxed">{children}</div>
    </div>
  )
}

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-2">Terms of Service</h1>
        <p className="text-gray-500 text-sm">Last updated October 7, 2026</p>
      </div>

      <Section title="1. The service">
        <p>GenID Protocol (&ldquo;GenID,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;), operated by DealDily, lets a
          Stripe-identity-verified individual cryptographically certify authorship of digital content: a hash-chained
          record of a content session, an optional Polygon blockchain anchor, a C2PA/CAWG manifest, and a signed
          certificate PDF. These Terms govern your use of the website, API, and browser extension.</p>
      </Section>

      <Section title="2. Eligibility and your account">
        <p>You must complete Stripe Identity verification (government ID + selfie) to register. You&apos;re
          responsible for the accuracy of what you submit and for keeping your account and any API keys you generate
          secure. A one-time identity verification fee (currently $1.50, charged by Stripe) applies at registration.
          GenID has no recurring subscription today — if that changes, we&apos;ll update these Terms and disclose any
          auto-renewal terms clearly before you&apos;re charged.</p>
      </Section>

      <Section title="3. Acceptable use">
        <p>You agree not to use GenID to certify content you don&apos;t have the rights to — including images, fonts,
          or other material licensed to someone else — or to otherwise misrepresent authorship. You agree not to
          attempt to circumvent identity verification, rate limits, or the integrity of the hash-chain/certificate
          system itself.</p>
      </Section>

      <Section title="4. Your content">
        <p>You retain ownership of content you certify through GenID. By submitting content, you grant us the
          limited right to process, store, and display it as needed to run the certification pipeline (hashing,
          anchoring, manifest embedding, certificate generation, and public verification at a session&apos;s verify
          URL). See our <Link href="/privacy" className="text-violet-400 hover:text-violet-300">Privacy Policy</Link> for
          how long we keep it and what happens if you delete your account.</p>
      </Section>

      <Section title="5. No uptime guarantee">
        <p>GenID does not currently offer or claim a service-level uptime guarantee. The service is provided on a
          commercially reasonable-efforts basis. If we introduce a specific SLA for any tier in the future, it will
          be stated explicitly and only for the tier it applies to.</p>
      </Section>

      <Section title="6. Disclaimer of warranties">
        <p>GenID is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties of any kind,
          express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We
          don&apos;t warrant that the service will be uninterrupted, error-free, or that a Polygon anchor will
          confirm within any particular time — anchoring is optional and non-blocking, and a certificate is fully
          valid without one.</p>
      </Section>

      <Section title="7. Limitation of liability">
        <p>To the maximum extent permitted by law, GenID and DealDily will not be liable for any indirect,
          incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or
          goodwill, arising from your use of the service. Our total liability for any claim arising from these
          Terms or the service is capped at the greater of (a) the amount you paid us in the 12 months before the
          claim arose, or (b) $100. Nothing in this section limits liability that can&apos;t be limited under
          applicable law.</p>
      </Section>

      <Section title="8. Termination and cancellation">
        <p>You can delete your account at any time from your <Link href="/dashboard" className="text-violet-400 hover:text-violet-300">dashboard</Link> —
          see our <Link href="/privacy" className="text-violet-400 hover:text-violet-300">Privacy Policy</Link> for
          exactly what that does. We may suspend or terminate access for a violation of these Terms, including
          certifying content you don&apos;t have rights to or attempting to circumvent identity verification or rate
          limits.</p>
      </Section>

      <Section title="9. Blockchain anchors are permanent">
        <p>A Polygon anchor transaction is public and permanent once confirmed, and exists outside GenID&apos;s
          control. Account deletion, content removal, or termination of these Terms does not and cannot remove it
          from the blockchain.</p>
      </Section>

      <Section title="10. Changes to these Terms">
        <p>We&apos;ll update the date at the top of this page when these Terms change, and post the new version
          here. Continued use of GenID after a change constitutes acceptance of the updated Terms.</p>
      </Section>

      <Section title="11. Governing law">
        <p>These Terms are governed by the laws of the jurisdiction in which DealDily is organized, without regard
          to conflict-of-law principles.</p>
      </Section>

      <Section title="12. Contact">
        <p>Questions about these Terms: <a href="mailto:legal@genid.app" className="text-violet-400 hover:text-violet-300">legal@genid.app</a></p>
      </Section>
    </div>
  )
}
