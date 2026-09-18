export default function Home() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-20">
      <div className="text-center mb-20">
        <div className="inline-flex items-center gap-2 bg-violet-100 border border-violet-300 rounded-full px-4 py-1.5 text-sm text-violet-700 mb-6">
          <span className="w-2 h-2 bg-violet-500 rounded-full animate-pulse"></span>
          Patent Pending — Priority Date April 27, 2026
        </div>
        <h1 className="text-5xl font-bold tracking-tight text-white mb-6 leading-tight">
          Every AI-Generated Image<br />
          <span className="text-violet-400">Carries Its Creator&apos;s Identity</span>
        </h1>
        <p className="text-xl text-gray-300 max-w-2xl mx-auto mb-10">
          GENID Protocol cryptographically embeds a verified human identity into AI-generated content
          at the moment of creation — invisible to the eye, signed, and independently verifiable by anyone.
        </p>
        <div className="flex items-center justify-center gap-4">
          <a href="/register" className="bg-violet-600 hover:bg-violet-500 text-white px-8 py-3 rounded-lg font-medium text-lg transition-colors shadow-lg">
            Get Your GENID
          </a>
          <a href="/verify" className="border border-gray-500 hover:border-white text-gray-200 hover:text-white px-8 py-3 rounded-lg font-medium text-lg transition-colors">
            Verify an Image
          </a>
        </div>
      </div>

      <div className="mb-20">
        <h2 className="text-2xl font-bold text-center mb-12 text-white">How GENID Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[
            { step: '01', title: 'Verify Identity', desc: 'Complete government ID verification via Stripe Identity. One-time, takes 2 minutes.' },
            { step: '02', title: 'Receive GENID', desc: 'Get your unique creator code (e.g. SA11212) permanently tied to your verified identity.' },
            { step: '03', title: 'Stamp Your Content', desc: 'Upload any AI-generated image. GENID embeds your code invisibly using LSB steganography.' },
            { step: '04', title: 'Blockchain Anchored', desc: 'GENID attempts to anchor every stamp on the Polygon blockchain with a timestamp and hash. Verification never depends on that anchor succeeding — it works off the signed record either way.' },
          ].map(({ step, title, desc }) => (
            <div key={step} className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <div className="text-violet-600 font-mono text-sm mb-3 font-bold">{step}</div>
              <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
              <p className="text-gray-600 text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
        {[
          { title: 'LSB Steganography', desc: 'Your GENID is hidden in the least significant bits of each pixel — invisible to the human eye, but extractable by any verification tool.', tag: 'Core Tech' },
          { title: 'Blockchain Provenance', desc: 'Every stamped image is signed and logged immediately; GENID also attempts to anchor it on Polygon with content hash, creator GENID, and UTC timestamp for an additional public record.', tag: 'Polygon Network' },
          { title: 'KYC Identity Binding', desc: 'No pseudonyms. Each GENID is bound to a government-verified identity through Stripe Identity, providing legal accountability.', tag: 'Stripe Identity' },
          { title: 'Public Verification', desc: 'Anyone can upload an image to our verification endpoint and see who submitted it through GenID, when, and with what platform — this confirms the submitter, not who created the underlying content or whether it was AI-generated.', tag: 'Open Verification' },
          { title: 'Lossless PNG Encoding', desc: 'Output is always an uncompressed PNG, so the embedded GENID survives as long as the file stays untouched. Re-saving as JPEG, resizing, or letting a platform recompress the upload can strip it — always verify the exact file you received.', tag: 'Robust Encoding' },
          { title: 'Legal Mandate Ready', desc: 'Designed to be adopted as a mandatory standard — every AI platform can integrate GENID Protocol through a simple API.', tag: 'Policy Ready' },
        ].map(({ title, desc, tag }) => (
          <div key={title} className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md hover:border-violet-300 transition-all">
            <div className="text-xs text-violet-600 mb-3 font-mono font-semibold">{tag}</div>
            <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
            <p className="text-gray-600 text-sm leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      <div className="text-center bg-violet-600 rounded-2xl p-12 shadow-lg">
        <h2 className="text-3xl font-bold text-white mb-4">Start Building Accountability Into AI</h2>
        <p className="text-violet-100 mb-8 max-w-xl mx-auto">
          Register your GENID today. Identity verification takes 2 minutes. Your first stamp is free.
        </p>
        <a href="/register" className="bg-white hover:bg-gray-100 text-violet-700 px-10 py-3 rounded-lg font-medium text-lg transition-colors shadow">
          Register Now — Free
        </a>
      </div>
    </div>
  )
}
