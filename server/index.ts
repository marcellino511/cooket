import { createServer } from 'node:http'
import { CHAIN_ID, PORT, PRIVY_APP_ID, ROUTER_ADDRESS } from './config'
import { handle } from './app'
import { storageStatus } from './store'

// Local development server. Production runs the same handler as a Vercel Function (api/[...path].mjs).
createServer((req, res) => {
  void handle(req, res)
}).listen(PORT, () => {
  console.log(
    `[cooket-server] listening on :${PORT} (Arc Mainnet ${CHAIN_ID}, auth ${PRIVY_APP_ID ? 'on' : 'OFF: VITE_PRIVY_APP_ID missing'}, storage ${storageStatus()}, router ${ROUTER_ADDRESS ?? 'not configured: links use direct transfers'})`,
  )
})
