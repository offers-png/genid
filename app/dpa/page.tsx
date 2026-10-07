import Link from 'next/link'

export const metadata = {
  title: 'Data Processing Agreement — GENID Protocol',
  description: 'Terms for business users processing personal data through the GenID API.',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-4">
      <h2 className="text-lg font-semibold text-white mb-3">{title}</h2>
      <div className="text-sm text-gray-300 space-y-3 leading-relaxed">{children}</div>
    </div>
  )
}

export default function DpaPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-2">Data Processing Agreement</h1>
        <p className="text-gray-500 text-sm">Last updated October 7, 2026</p>
        <p className="text-gray-400 mt-3">
          For business users integrating the GenID API (<Link href="/dashboard/api-keys" className="text-violet-400 hover:text-violet-300">API keys</Link>) —
          where you submit content on behalf of your own end users, this DPA supplements our{' '}
          <Link href="/terms" className="text-violet-400 hover:text-violet-300">Terms of Service</Link> and applies
          automatically to that use. If you&apos;re using GenID only for your own content under your own account, you
          don&apos;t need this document — our <Link href="/privacy" className="text-violet-400 hover:text-violet-300">Privacy Policy</Link> covers
          that relationship.
        </p>
      </div>

      <Section title="1. Roles">
        <p>Where you (the &ldquo;Customer&rdquo;) submit personal data belonging to your own end users through the
          GenID API — for example, a user-submitted image containing identifiable people — Customer is the
          controller and GenID (operated by DealDily) is the processor, processing that data solely to provide the
          certification pipeline (hashing, optional blockchain anchoring, manifest embedding, certificate
          generation) as instructed by Customer&apos;s use of the API.</p>
      </Section>

      <Section title="2. Scope of processing">
        <p><strong className="text-white">Subject matter:</strong> images and associated metadata submitted via the
          GenID API. <strong className="text-white">Duration:</strong> for as long as Customer&apos;s account is active,
          plus the retention described in our <Link href="/privacy" className="text-violet-400 hover:text-violet-300">Privacy Policy</Link>.{' '}
          <strong className="text-white">Nature:</strong> storage, hashing, cryptographic signing, optional blockchain
          anchoring, and certificate generation. <strong className="text-white">Categories of data subjects:</strong> Customer&apos;s
          end users whose content is submitted for certification.</p>
      </Section>

      <Section title="3. Subprocessors">
        <p>GenID uses the subprocessors listed at <Link href="/subprocessors" className="text-violet-400 hover:text-violet-300">/subprocessors</Link>,
          which states what each one is for and what data it receives. We&apos;ll update that page if our
          subprocessors change.</p>
      </Section>

      <Section title="4. Security measures">
        <p>Identity verification is handled directly by Stripe Identity — we never receive the raw ID document or
          selfie. API keys are stored as cryptographic hashes, never in plaintext. Session content is hash-chained
          and signed so any tampering is independently detectable. Storage access runs only through server-side,
          service-role-authenticated routes, never direct client access.</p>
      </Section>

      <Section title="5. Sub-processing and international transfer">
        <p>Our subprocessors are primarily US-based (see <Link href="/subprocessors" className="text-violet-400 hover:text-violet-300">/subprocessors</Link> for
          each one&apos;s location). Where Customer or its end users are located outside the US, data is transferred to
          and processed in the US.</p>
      </Section>

      <Section title="6. Assistance with data subject rights">
        <p>Where Customer needs to respond to one of its end users&apos; data subject requests (access, deletion,
          etc.) concerning data processed through GenID, contact us at the address below and we&apos;ll provide
          reasonable assistance — including, for deletion, the same scope described in our{' '}
          <Link href="/privacy" className="text-violet-400 hover:text-violet-300">Privacy Policy</Link> (a finalized,
          certified session&apos;s hash-chain records and stored image are retained to preserve third-party
          verifiability, and nothing can be removed from a Polygon anchor once confirmed).</p>
      </Section>

      <Section title="7. Breach notification">
        <p>We&apos;ll notify Customer without undue delay after becoming aware of a security breach affecting
          Customer&apos;s data processed under this DPA.</p>
      </Section>

      <Section title="8. Term">
        <p>This DPA is effective for as long as Customer uses the GenID API to process personal data on behalf of
          its own end users, and terminates automatically when the underlying Terms of Service terminate.</p>
      </Section>

      <Section title="9. Contact">
        <p>Questions about this DPA, or to request a countersigned copy for your own records:{' '}
          <a href="mailto:legal@genid.app" className="text-violet-400 hover:text-violet-300">legal@genid.app</a></p>
      </Section>
    </div>
  )
}
