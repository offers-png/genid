import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import type { StepRecord } from './supabase'
import { downloadFromSessionBucket } from './storage'

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

// The PDF's version-history thumbnail is 140x140 (see generateCertificatePdf
// below) — no need to hold a full-resolution original in memory just to
// shrink it at render time. Only applied to non-final steps; the final
// step's buffer is also used as the source for the C2PA-signed export
// (app/api/session/[id]/finalize/route.ts) and must stay untouched.
const THUMBNAIL_MAX_DIMENSION = 300

// Shared by the finalize route and the certificate-regenerate route, so
// both build the exact same timeline from the same source data. Downloads
// whatever is CURRENTLY stored at each step's path — for an already-
// archived non-final step (lib/lifecycle.ts) that's the compressed copy,
// which is expected and fine for a certificate thumbnail. For a session
// with many non-final steps (rejected regenerations/edits), downsizing
// each one here — rather than embedding it full-resolution into the PDF
// only to render at 140x140 — is what keeps this step's memory/PDF-size
// cost from scaling with the original image size (Sept 18 second
// follow-up, "fetching all images for certificates will become
// expensive").
export async function buildCertificateSteps(steps: StepRecord[], finalStepId: string): Promise<CertificateStep[]> {
  return Promise.all(
    steps.map(async (step): Promise<CertificateStep> => {
      const isFinal = step.id === finalStepId
      let imageBuffer: Buffer | null = null
      if (step.output_storage_path) {
        const original = await downloadFromSessionBucket(step.output_storage_path)
        imageBuffer = isFinal
          ? original
          : await sharp(original)
              .resize({ width: THUMBNAIL_MAX_DIMENSION, height: THUMBNAIL_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
              .png({ compressionLevel: 9 })
              .toBuffer()
      }
      return {
        stepNumber: step.step_number,
        stepType: step.step_type,
        editType: step.edit_type,
        promptText: step.prompt_text,
        userNote: step.user_note,
        outputHash: step.output_hash,
        stepSignature: step.step_signature,
        responseTimestamp: step.response_timestamp,
        imageBuffer,
        isFinal,
      }
    })
  )
}

// Authorship Certificate (Build Spec Section 3.2.7, extended per Section
// 4.1.6 to show the full step timeline — every version, not just the final
// output — once Phase 2 sessions can have more than one step).
export function generateCertificatePdf(params: {
  genidCode: string
  creatorName: string
  nameVerified: boolean
  sessionId: string
  totalSteps: number
  totalDurationSeconds: number
  steps: CertificateStep[]
  generatedAt: Date
  verifyUrl?: string
  c2paManifestEmbedded?: boolean
  sessionRootHash?: string
  polygonAnchorTx?: string | null
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
    doc.text(`Creator: ${params.creatorName}${params.nameVerified ? '' : ' (self-reported, not ID-verified)'}`)
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

    ensureSpace(80)
    doc.fontSize(15).text('Blockchain Anchor', { underline: true })
    doc.moveDown(0.4)
    if (params.polygonAnchorTx) {
      doc.fontSize(9).text(
        'The session root hash below was anchored to the Polygon blockchain at finalize time — the ' +
          'transaction was confirmed on-chain before this certificate was generated.'
      )
      doc.moveDown(0.3)
      doc.font('Courier').fontSize(9)
      if (params.sessionRootHash) doc.text(`Session root hash: ${params.sessionRootHash}`)
      doc.text(`Polygon transaction: ${params.polygonAnchorTx}`)
      doc.font('Helvetica').fillColor('#5b21b6')
      doc.text(`https://polygonscan.com/tx/${params.polygonAnchorTx}`)
      doc.fillColor('#000000')
    } else {
      doc.fontSize(9).fillColor('gray').text(
        'This session was not anchored to Polygon — blockchain anchoring is optional and non-blocking, ' +
          'so a network or configuration issue at finalize time does not prevent certificate generation. ' +
          'The signature chain above does not depend on this anchor to be tamper-evident.'
      )
      doc.fillColor('#000000')
    }
    doc.moveDown(0.8)

    if (params.c2paManifestEmbedded) {
      ensureSpace(60)
      doc.fontSize(15).text('C2PA / CAWG Manifest', { underline: true })
      doc.moveDown(0.4)
      doc.fontSize(9).fillColor('gray').text(
        'A standards-based C2PA manifest with a CAWG identity assertion is embedded in the exported image, ' +
          'readable by any C2PA-compatible tool. It is signed with a real certificate that is not yet a member ' +
          'of the official C2PA Trust List, so third-party verifiers will correctly report the signing ' +
          'credential as untrusted until that registration is complete. See the verification link above for ' +
          'the current status.',
        { align: 'left' }
      )
      doc.fillColor('#000000')
      doc.moveDown(0.8)
    }

    ensureSpace(60)
    doc.moveDown(0.6)
    doc.fontSize(8).fillColor('gray').text(
      'This certificate documents a process recorded under the named GenID account — every version, ' +
        'when it was submitted, and under which identity — and is tamper-evident via the signatures ' +
        'above. It records who submitted this content through GenID, not necessarily who created the ' +
        'underlying image or whether it was AI-generated. It does not grant copyright; ' +
        'copyrightability is determined by courts and the U.S. Copyright Office.',
      { align: 'left' }
    )

    doc.end()
  })
}
