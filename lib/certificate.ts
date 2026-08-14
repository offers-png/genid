import PDFDocument from 'pdfkit'

// First-pass Authorship Certificate (Build Spec Section 3.2.7 — Phase 1
// definition of done only requires prompt, output, timestamp, signature;
// the full timeline/QR/C2PA-embedded version is Phase 7).
export function generateCertificatePdf(params: {
  genidCode: string
  creatorName: string
  sessionId: string
  promptText: string
  imageBuffer: Buffer
  outputHash: string
  stepSignature: string
  generatedAt: Date
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(20).text('GenID Authorship Certificate', { align: 'center' })
    doc.moveDown(1.5)

    doc.fontSize(11)
    doc.text(`GENID Code: ${params.genidCode}`)
    doc.text(`Creator: ${params.creatorName}`)
    doc.text(`Session ID: ${params.sessionId}`)
    doc.text(`Generated: ${params.generatedAt.toISOString()}`)
    doc.moveDown()

    doc.fontSize(13).text('Prompt', { underline: true })
    doc.fontSize(11).text(params.promptText)
    doc.moveDown()

    doc.image(params.imageBuffer, { fit: [450, 450], align: 'center' })
    doc.moveDown()

    doc.fontSize(13).text('Signature', { underline: true })
    doc.fontSize(9).font('Courier')
    doc.text(`Output hash (SHA-256): ${params.outputHash}`)
    doc.text(`Step signature (HMAC-SHA256): ${params.stepSignature}`)
    doc.moveDown()

    doc.font('Helvetica').fontSize(8).fillColor('gray').text(
      'This certificate documents the creative process behind this content — what was created, ' +
        'when, and by whom — and is tamper-evident via the signature above. It does not grant ' +
        'copyright; copyrightability is determined by courts and the U.S. Copyright Office.',
      { align: 'left' }
    )

    doc.end()
  })
}
