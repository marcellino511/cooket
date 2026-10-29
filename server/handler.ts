import type { IncomingMessage, ServerResponse } from 'node:http'
import { handle } from './app'

/** Vercel Function entry (bundled into api/_handler.mjs at build time). */
export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handle(req, res)
}
