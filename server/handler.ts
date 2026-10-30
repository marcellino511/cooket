import type { IncomingMessage, ServerResponse } from 'node:http'
import { handle } from './app'

/** Vercel Function entry (bundled into api/_handler.mjs at build time). */
export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Standalone Vercel Node functions do not give this Vite app Next.js catch-all routing.
  // Accept both the original URL and the concrete rewrite destination URL. Vercel may
  // supply destination query parameters on req.query instead of req.url.
  const url = new URL(req.url ?? '/', 'http://local')
  if (['/api', '/api/', '/api/index', '/api/index.mjs'].includes(url.pathname)) {
    const query = (req as IncomingMessage & { query?: Record<string, unknown> }).query
    const path = url.searchParams.get('__cooket_path') ?? query?.__cooket_path
    if (path !== undefined && path !== null) {
      if (typeof path !== 'string' || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path)) {
        res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: 'Not found.', code: 'not_found' }))
        return Promise.resolve()
      }
      url.searchParams.delete('__cooket_path')
      req.url = `/api/${path}${url.search}`
    }
  }
  return handle(req, res)
}
