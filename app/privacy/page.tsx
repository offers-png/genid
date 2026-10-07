import Link from 'next/link'

export const metadata = {
  title: 'Privacy Policy — GENID Protocol',
  description: 'What GenID collects, why, and what rights you have over it.',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-4">
      <h2 className="text-lg font-semibold text-white mb-3">{title}</h2>
      <div className="text-sm text-gray-300 space-y-3 leading-relaxed">{children}</div>
    </div>
  )
}

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-gray-500 text-sm">Last updated October 7, 2026</p>
      </div>

      <Section title="Who we are">
        <p>
          GenID Protocol is operated by DealDily (&ldquo;GenID,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;). This policy
          covers the GenID website, the API, and the browser extension.
        </p>
      </Section>

      <Section title="What we collect">
        <p><strong className="text-white">Account &amp; identity.</strong> Your name and email address, and the result
          of Stripe Identity verification (government ID + selfie). Stripe handles the document and selfie images
          directly — we store only the verification outcome and Stripe&apos;s own session identifiers, never the ID
          document or selfie image itself.</p>
        <p><strong className="text-white">Content you certify.</strong> Images you generate, upload, or edit through
          GenID, plus the metadata that makes up a certificate: timestamps, prompts, edit history, cryptographic
          hashes and signatures, and (if anchored) a Polygon blockchain transaction.</p>
        <p><strong className="text-white">Cookies.</strong> Only what&apos;s required to keep you signed in and to
          protect forms from forgery — a session cookie and a CSRF token. Neither is used for tracking or analytics,
          and GenID does not run any analytics or advertising scripts today. Because these cookies are strictly
          necessary for the service to function, they don&apos;t require a cookie-consent banner under GDPR/ePrivacy —
          we still disclose them here for clarity.</p>
        <p><strong className="text-white">API keys.</strong> If you generate a developer API key, we store a
          cryptographic hash of it, never the raw key — the raw value is shown to you once and can&apos;t be
          retrieved again, only revoked.</p>
      </Section>

      <Section title="How we use it">
        <p>To run the certification pipeline (hash-chaining, C2PA/CAWG manifest embedding, Polygon anchoring,
          certificate generation), to verify your identity once at registration, to send you sign-in and
          registration emails, and to enforce fair-use rate limits.</p>
        <p>Text prompts for GenID&apos;s own image-generation step are sent to OpenAI to produce the image. Images
          you upload or that come from an external tool are never sent to OpenAI or any other model provider — they
          go directly into the certification pipeline.</p>
      </Section>

      <Section title="Who we share it with">
        <p>We use a small number of subprocessors to run the product — see the full list, with what each one
          receives, at <Link href="/subprocessors" className="text-violet-400 hover:text-violet-300">/subprocessors</Link>.
          We don&apos;t sell your data, and we don&apos;t share it with anyone else for their own marketing purposes.</p>
      </Section>

      <Section title="The blockchain anchor is public and permanent">
        <p>When a session is anchored on Polygon, the transaction — including the session&apos;s root hash — becomes
          part of a public, permanent blockchain record outside our control. It does not contain your name, email, or
          the image itself, only a cryptographic digest. We cannot remove it, including after an account deletion
          request (see &ldquo;Your rights&rdquo; below).</p>
      </Section>

      <Section title="How long we keep it">
        <p>Session and certificate records are kept indefinitely by default, since a certificate is meant to remain
          independently verifiable by anyone, indefinitely. Full-resolution images for steps you didn&apos;t select as
          final are compressed shortly after a session is finalized; the final/certified image and the certificate
          itself stay full-resolution.</p>
      </Section>

      <Section title="Your rights">
        <p><strong className="text-white">Export.</strong> Download a full copy of your account&apos;s data — sessions,
          steps, certificates, stamp history — any time from your <Link href="/dashboard" className="text-violet-400 hover:text-violet-300">dashboard</Link>.</p>
        <p><strong className="text-white">Deletion.</strong> You can delete your account from the same dashboard. This
          deletes any session you never finalized (including its stored images), revokes your API keys, and clears
          your name and email from our records. It does <em>not</em> delete the hash-chain records or stored images
          behind a session you already finalized: a finalized certificate is a proof third parties may already be
          relying on, and because our verification check re-hashes the stored file to confirm it hasn&apos;t been
          tampered with, removing that file would make a legitimate certificate incorrectly report as tampered
          rather than simply unavailable. If you need a finalized certificate&apos;s image removed for a specific
          reason, contact us at the address below and we&apos;ll work through it with you individually. Nothing we
          delete or anonymize can be removed from the Polygon blockchain — see above.</p>
        <p>These map to the data access and erasure rights available under GDPR, CCPA, and similar laws, regardless
          of where you&apos;re located.</p>
      </Section>

      <Section title="Children">
        <p>GenID requires government ID verification to register, so the service isn&apos;t directed at or knowingly
          used by children.</p>
      </Section>

      <Section title="International transfers">
        <p>Our subprocessors (listed at <Link href="/subprocessors" className="text-violet-400 hover:text-violet-300">/subprocessors</Link>)
          are primarily US-based. If you&apos;re accessing GenID from outside the US, your data is transferred to and
          processed in the US.</p>
      </Section>

      <Section title="Changes to this policy">
        <p>We&apos;ll update the date at the top of this page when this policy changes, and post the new version here.</p>
      </Section>

      <Section title="Contact">
        <p>Questions or a privacy request: <a href="mailto:privacy@genid.app" className="text-violet-400 hover:text-violet-300">privacy@genid.app</a></p>
      </Section>
    </div>
  )
}
