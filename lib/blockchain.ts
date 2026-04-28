import { ethers } from 'ethers'

// Polygon Mainnet via Alchemy
// Each GENID stamp writes a tiny transaction to Polygon with the content hash as calldata.
// Cost: fractions of a cent per transaction (MATIC gas).

function getProvider(): ethers.JsonRpcProvider {
  const alchemyKey = process.env.ALCHEMY_API_KEY!
  return new ethers.JsonRpcProvider(
    `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`
  )
}

function getWallet(): ethers.Wallet {
  const provider = getProvider()
  return new ethers.Wallet(process.env.POLYGON_WALLET_PRIVATE_KEY!, provider)
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
  const wallet = getWallet()

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

  const block = await getProvider().getBlock(receipt.blockNumber)

  return {
    txHash: receipt.hash,
    network: 'polygon',
    blockNumber: receipt.blockNumber,
    timestamp: block?.timestamp ?? Math.floor(Date.now() / 1000),
  }
}

export async function verifyOnBlockchain(txHash: string): Promise<{
  confirmed: boolean
  payload: string | null
  blockNumber: number | null
}> {
  const provider = getProvider()
  const tx = await provider.getTransaction(txHash)

  if (!tx) return { confirmed: false, payload: null, blockNumber: null }

  const payload = tx.data ? ethers.toUtf8String(tx.data) : null

  return {
    confirmed: true,
    payload,
    blockNumber: tx.blockNumber,
  }
}
