function getEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
      `Set this in your .env.local file or deployment environment.`
    )
  }
  return value
}

// Lazy getters — resolved at request time, not at build time.
export const env = {
  get supabaseUrl()        { return getEnv('NEXT_PUBLIC_SUPABASE_URL') },
  get supabaseServiceKey() { return getEnv('SUPABASE_SERVICE_ROLE_KEY') },
  get stripeSecretKey()    { return getEnv('STRIPE_SECRET_KEY') },
  get stripeWebhookSecret(){ return getEnv('STRIPE_WEBHOOK_SECRET') },
  get genidSigningSecret() { return getEnv('GENID_SIGNING_SECRET') },
  get openaiApiKey()       { return getEnv('OPENAI_API_KEY') },
  get alchemyApiKey()      { return process.env.ALCHEMY_API_KEY },
  get polygonWalletKey()   { return process.env.POLYGON_WALLET_PRIVATE_KEY },
  get appUrl()             { return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000' },
}
