import { NextRequest, NextResponse } from 'next/server'
// Note: stampedBuffer response uses native Response (not NextResponse) for binary compatibility
import { embedGenid, hashBuffer, generateNotarySignature } from '@/lib/steganography'
import { lookupByEmail, logContent } from '@/lib/supabase'
import { stampOnBlockchain } from '@/lib/blockchain'

// POST multipart/form-data: { email, image }
// Returns: the steganographically-stamped image with embedded notary signature
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const email = formData.get('email') as string
    const imageFile = formData.get('image') as File

    if (!email || !imageFile) {
      return NextResponse.json({ error: 'Email and image are required' }, { status: 400 })
    }

    const record = await lookupByEmail(email)
    if (!record) {
      return NextResponse.json({ error: 'No GENID found for this email. Please register first.' }, { status: 404 })
    }
    if (!record.verified) {
      return NextResponse.json({ error: 'Your identity has not been verified yet.' }, { status: 403 })
    }

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer())
    const originalHash = hashBuffer(imageBuffer)
    const timestamp = Math.floor(Date.now() / 1000)

    const signingSecret = process.env.GENID_SIGNING_SECRET ?? 'genid-default-secret'
    const notaryPayload = generateNotarySignature(
      record.genid_code,
      originalHash,
      timestamp,
      signingSecret
    )

    const stampedBuffer = await embedGenid(
      imageBuffer,
      record.genid_code,
      imageFile.type,
      notaryPayload
    )
    const stampedHash = hashBuffer(stampedBuffer)

    let txHash: string | null = null
    try {
      const stamp = await stampOnBlockchain({
        genidCode: record.genid_code,
        contentHash: stampedHash,
        fileName: imageFile.name,
      })
      txHash = stamp.txHash
    } catch (blockchainErr) {
      console.error('Blockchain stamp failed (non-fatal):', blockchainErr)
    }

    await logContent({
      genid_code: record.genid_code,
      content_hash: stampedHash,
      file_name: imageFile.name,
      file_type: imageFile.type,
      platform: 'GENID Protocol',
      blockchain_tx_hash: txHash,
      blockchain_network: 'polygon',
    })

    const originalBase = imageFile.name.replace(/\.[^.]+$/, '')
    const safeBase = originalBase.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40)

    return new Response(new Uint8Array(stampedBuffer), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="genid-stamped-${safeBase}.png"`,
        'X-GENID-Code': record.genid_code,
        'X-Content-Hash': stampedHash,
        'X-Blockchain-TX': txHash ?? 'pending',
        'X-Notary-Timestamp': timestamp.toString(),
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Embedding failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
