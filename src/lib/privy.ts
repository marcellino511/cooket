/** Public Privy App ID, read from the environment. It is safe to expose; Privy secrets never belong in the browser. */
export const PRIVY_APP_ID: string = (import.meta.env.VITE_PRIVY_APP_ID as string | undefined)?.trim() ?? ''
