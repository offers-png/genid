import { NextRequest, NextResponse } from 'next/server'
// Note: stampedBuffer response uses native Response (not NextResponse) for binary compatibility
import { embedGenid, hashBuffer } from '@/lib/steganography'
import { lookupByEmail, logContent } from '@/lib/supabase'
import { stampOnBlockchain } from '@/lib/blockchain'

// POST multipart/form-data: { email, image }
// Returns: the steganographically-stamped image + logs to blockchain
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const email = formData.get('email') as string
    const imageFile = formData.get('image') as File

    if (!email || !imageFile) {
      return NextResponse.json({ error: 'Email and image are required' }, { status: 400 })
    }

    // Look up the user's GENID
    const record = await lookupByEmail(email)
    if (!record) {
      return NextResponse.json({ error: 'No GENID found for this email. Please register first.' }, { status: 404 })
    }
    if (!record.verified) {
      return NextResponse.json({ error: 'Your identity has not been verified yet.' }, { status: 403 })
    }

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer())
    // Embed GENID using LSB steganography
    const stampedBuffer = await embedGenid(imageBuffer, record.genid_code, imageFile.type)
    const stampedHash = hashBuffer(stampedBuffer)

    // Log to blockchain (async — don't fail the request if this is slow)
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

    // Log to Supabase
    await logContent({
      genid_code: record.genid_code,
      content_hash: stampedHash,
      file_name: imageFile.name,
      file_type: imageFile.type,
      platform: 'GENID Protocol',
      blockchain_tx_hash: txHash,
      blockchain_network: 'polygon',
    })

    return new Response(new Uint8Array(stampedBuffer), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="genid-${record.genid_code}-${imageFile.name.replace(/\.[^.]+$/, '')}.png"`,
        'X-GENID-Code': record.genid_code,
        'X-Content-Hash': stampedHash,
        'X-Blockchain-TX': txHash ?? 'pending',
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Embedding failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
