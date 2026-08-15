import PDFDocument from 'pdfkit'

export interface CertificateStep {
  stepNumber: number
  stepType: string
  editType: string | null
  promptText: string | null
  userNote: string | null
  outputHash: string | null
  stepSignature: string | null
  responseTimestamp: string | null
  imageBuffer: Buffer | null
  isFinal: boolean
}

// Authorship Certificate (Build Spec Section 3.2.7, extended per Section
// 4.1.6 to show the full step timeline — every version, not just the final
// output — once Phase 2 sessions can have more than one step).
export function generateCertificatePdf(params: {
  genidCode: string
  creatorName: string
  sessionId: string
  totalSteps: number
  totalDurationSeconds: number
  steps: CertificateStep[]
  generatedAt: Date
  verifyUrl?: string
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const pageBottom = () => doc.page.height - doc.page.margins.bottom
    const ensureSpace = (needed: number) => {
      if (doc.y + needed > pageBottom()) doc.addPage()
    }

    const finalStep = params.steps.find((s) => s.isFinal) ?? params.steps[params.steps.length - 1]

    doc.fontSize(20).text('GenID Authorship Certificate', { align: 'center' })
    doc.moveDown(1.5)

    doc.fontSize(11)
    doc.text(`GENID Code: ${params.genidCode}`)
    doc.text(`Creator: ${params.creatorName}`)
    doc.text(`Session ID: ${params.sessionId}`)
    doc.text(`Generated: ${params.generatedAt.toISOString()}`)
    doc.text(`Total Steps: ${params.totalSteps}`)
    doc.text(`Total Session Duration: ${params.totalDurationSeconds}s`)
    doc.moveDown(1.2)

    if (finalStep) {
      doc.fontSize(15).text('Final Selection', { underline: true })
      doc.moveDown(0.4)
      doc.fontSize(11).text(`Step ${finalStep.stepNumber} — ${finalStep.stepType}${finalStep.editType ? ` (${finalStep.editType})` : ''}`)
      if (finalStep.promptText) doc.fontSize(11).text(`Prompt: ${finalStep.promptText}`)
      if (finalStep.userNote) doc.fontSize(11).text(`Note: ${finalStep.userNote}`)
      doc.moveDown(0.6)

      if (finalStep.imageBuffer) {
        ensureSpace(320)
        doc.image(finalStep.imageBuffer, { fit: [420, 300], align: 'center' })
        doc.moveDown(0.6)
      }

      doc.fontSize(9).font('Courier')
      doc.text(`Output hash (SHA-256): ${finalStep.outputHash ?? ''}`)
      doc.text(`Step signature (HMAC-SHA256): ${finalStep.stepSignature ?? ''}`)
      doc.font('Helvetica')
      doc.moveDown(1.2)
    }

    doc.fontSize(15).text('Version History', { underline: true })
    doc.moveDown(0.6)

    for (const step of params.steps) {
      ensureSpace(200)

      const label = `Step ${step.stepNumber} — ${step.stepType}${step.editType ? ` (${step.editType})` : ''}${step.isFinal ? '  ★ FINAL' : ''}`
      doc.fontSize(12).fillColor(step.isFinal ? '#5b21b6' : '#000000').text(label)
      doc.fillColor('#000000')

      if (step.responseTimestamp) {
        doc.fontSize(9).fillColor('gray').text(new Date(step.responseTimestamp).toISOString())
        doc.fillColor('#000000')
      }
      if (step.promptText) doc.fontSize(10).text(`Prompt: ${step.promptText}`)
      if (step.userNote) doc.fontSize(10).text(`Note: ${step.userNote}`)

      if (step.imageBuffer) {
        ensureSpace(160)
        doc.image(step.imageBuffer, { fit: [140, 140] })
        doc.moveDown(0.3)
      }

      doc.fontSize(8).font('Courier').fillColor('gray')
      doc.text(`hash: ${step.outputHash ?? ''}`)
      doc.font('Helvetica').fillColor('#000000')
      doc.moveDown(0.8)
    }

    if (params.verifyUrl) {
      ensureSpace(40)
      doc.fontSize(15).text('Verify This Certificate', { underline: true })
      doc.moveDown(0.4)
      doc.fontSize(10).fillColor('#5b21b6').text(params.verifyUrl)
      doc.fillColor('#000000')
      doc.moveDown(0.8)
    }

    ensureSpace(60)
    doc.moveDown(0.6)
    doc.fontSize(8).fillColor('gray').text(
      'This certificate documents the creative process behind this content — every version, when it ' +
        'was made, and by whom — and is tamper-evident via the signatures above. It does not grant ' +
        'copyright; copyrightability is determined by courts and the U.S. Copyright Office.',
      { align: 'left' }
    )

    doc.end()
  })
}
