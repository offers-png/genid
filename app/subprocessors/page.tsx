import Link from 'next/link'

export const metadata = {
  title: 'Subprocessors — GENID Protocol',
  description: 'Third-party services GenID uses to process your data.',
}

interface Subprocessor {
  name: string
  purpose: string
  dataShared: string
  location: string
}

const SUBPROCESSORS: Subprocessor[] = [
  {
    name: 'Supabase',
    purpose: 'Primary database and file storage — session/step/certificate records, uploaded and generated images, certificate PDFs.',
    dataShared: 'Account and session data, uploaded/generated images, certificates.',
    location: 'United States (AWS-hosted)',
  },
  {
    name: 'Stripe (Identity)',
    purpose: 'Government ID and selfie identity verification at registration, and the one-time verification fee.',
    dataShared: 'Name, email, government ID document, selfie — handled directly by Stripe; GenID stores only the verification result and Stripe\'s own session/verification identifiers, never the ID document or selfie image itself.',
    location: 'United States',
  },
  {
    name: 'Resend',
    purpose: 'Transactional email delivery — sign-in magic links and registration confirmation links.',
    dataShared: 'Email address, email content.',
    location: 'United States',
  },
  {
    name: 'OpenAI',
    purpose: 'Text-to-image generation (gpt-image-1) for the "generate from a prompt" step of the certification pipeline.',
    dataShared: 'Your text prompt. Uploaded/externally-sourced images are never sent to OpenAI — only prompts for images GenID itself generates.',
    location: 'United States',
  },
  {
    name: 'Alchemy',
    purpose: 'Polygon blockchain RPC access, used to anchor a session\'s root hash on-chain and to look up anchor transactions during verification.',
    dataShared: 'The session root hash (a cryptographic digest, not the image itself) submitted as transaction calldata — which, once submitted, is itself public on the Polygon blockchain, outside GenID\'s control.',
    location: 'United States',
  },
]

export default function SubprocessorsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-2">Subprocessors</h1>
        <p className="text-gray-400">
          Third-party services GenID uses to run the product, what each one is for, and what data it sees.
          See our <Link href="/privacy" className="text-violet-400 hover:text-violet-300">Privacy Policy</Link> and{' '}
          <Link href="/dpa" className="text-violet-400 hover:text-violet-300">Data Processing Agreement</Link> for
          the full picture.
        </p>
      </div>

      <div className="space-y-4">
        {SUBPROCESSORS.map((sp) => (
          <div key={sp.name} className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
              <h2 className="text-lg font-semibold text-white">{sp.name}</h2>
              <span className="text-xs text-gray-500 font-mono">{sp.location}</span>
            </div>
            <p className="text-sm text-gray-300 mb-2">{sp.purpose}</p>
            <p className="text-xs text-gray-500">
              <span className="text-gray-400 font-medium">Data shared: </span>
              {sp.dataShared}
            </p>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-600 mt-8">
        This list reflects what the product actually calls as of this writing. We&apos;ll update it if that
        changes. Questions: <a href="mailto:privacy@genid.app" className="text-violet-400 hover:text-violet-300">privacy@genid.app</a>.
      </p>
    </div>
  )
}
