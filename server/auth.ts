import type { IncomingMessage } from 'node:http'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { PRIVY_APP_ID } from './config'

// Privy access tokens are ES256 JWTs. They are verified against the app's published signing keys; no Privy secret is needed or used.
const jwks = PRIVY_APP_ID ? createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`)) : null

/** Returns the authenticated Privy user ID (DID), or null when the request has no valid access token. */
export async function authenticate(req: IncomingMessage): Promise<string | null> {
  if (!jwks) return null
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  try {
    const { payload } = await jwtVerify(header.slice(7), jwks, { issuer: 'privy.io', audience: PRIVY_APP_ID })
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}
