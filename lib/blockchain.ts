import { ethers } from 'ethers'

// Polygon Mainnet via Alchemy
// Each GENID stamp writes a tiny transaction to Polygon with the content hash as calldata.
// Cost: fractions of a cent per transaction (MATIC gas).
//
// staticNetwork asserts the chain id up front instead of letting ethers
// auto-detect it with an RPC call on every provider. This is safe here
// specifically because the URL is hardcoded to Alchemy's Polygon mainnet
// endpoint — it can never actually change networks underneath us, which is
// the one condition ethers' own docs require before using this option.
//
// It also fixes a real leak: without staticNetwork, a provider whose
// network detection fails keeps that detection retrying in the background
// forever, and nothing here was ever calling destroy() to stop it. Every
// failed stampOnBlockchain() call — confirmed live, 100% of finalize calls
// to date — left one of these behind, compounding over the deployment's
// uptime into exactly the repeating "failed to detect network" log noise
// that's been drowning out other errors. The destroy() in `finally` below
// closes that leak going forward regardless of the network setting.
const POLYGON_NETWORK = ethers.Network.from(137)

function getProvider(): ethers.JsonRpcProvider {
  const alchemyKey = process.env.ALCHEMY_API_KEY!
  return new ethers.JsonRpcProvider(
    `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    POLYGON_NETWORK,
    { staticNetwork: POLYGON_NETWORK }
  )
}

export interface BlockchainStamp {
  txHash: string
  network: string
  blockNumber: number
  timestamp: number
}

export async function stampOnBlockchain(params: {
  genidCode: string
  contentHash: string
  fileName: string
}): Promise<BlockchainStamp> {
  const provider = getProvider()
  try {
    const wallet = new ethers.Wallet(process.env.POLYGON_WALLET_PRIVATE_KEY!, provider)

    // Encode the stamp payload as hex calldata
    // Format: GENID:<code>|HASH:<hash>|FILE:<filename>
    const payload = `GENID:${params.genidCode}|HASH:${params.contentHash}|FILE:${params.fileName}`
    const data = ethers.hexlify(ethers.toUtf8Bytes(payload))

    // Send a 0-value transaction to ourselves with the stamp as calldata
    // This permanently records it on Polygon's immutable ledger
    const tx = await wallet.sendTransaction({
      to: wallet.address,
      value: BigInt(0),
      data,
      gasLimit: BigInt(50000),
    })

    const receipt = await tx.wait()
    if (!receipt) throw new Error('Transaction failed — no receipt')

    const block = await provider.getBlock(receipt.blockNumber)

    return {
      txHash: receipt.hash,
      network: 'polygon',
      blockNumber: receipt.blockNumber,
      timestamp: block?.timestamp ?? Math.floor(Date.now() / 1000),
    }
  } finally {
    provider.destroy()
  }
}

export async function verifyOnBlockchain(txHash: string): Promise<{
  confirmed: boolean
  payload: string | null
  blockNumber: number | null
}> {
  const provider = getProvider()
  try {
    const tx = await provider.getTransaction(txHash)

    if (!tx) return { confirmed: false, payload: null, blockNumber: null }

    const payload = tx.data ? ethers.toUtf8String(tx.data) : null

    return {
      confirmed: true,
      payload,
      blockNumber: tx.blockNumber,
    }
  } finally {
    provider.destroy()
  }
}
