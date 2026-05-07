const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'GENID_SIGNING_SECRET',
] as const

type RequiredEnvKey = typeof required[number]

function getEnv(key: RequiredEnvKey): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
      `Set this in your .env.local file or deployment environment.`
    )
  }
  return value
}

export const env = {
  supabaseUrl: getEnv('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseServiceKey: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
  stripeSecretKey: getEnv('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: getEnv('STRIPE_WEBHOOK_SECRET'),
  genidSigningSecret: getEnv('GENID_SIGNING_SECRET'),
  alchemyApiKey: process.env.ALCHEMY_API_KEY,
  polygonWalletKey: process.env.POLYGON_WALLET_PRIVATE_KEY,
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
}
