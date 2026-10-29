import { useState, type ReactNode } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useSetActiveWallet } from '@privy-io/wagmi'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, PageHeader } from '@/components/ui/Card'
import { SelectField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Address, CopyButton, ExternalAnchor, Notice, Toggle } from '@/components/ui/misc'
import { useSession } from '@/chain/useSession'
import { useFx } from '@/lib/fx'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { parseAmount } from '@/onchain-money'
import { DISPLAY_CURRENCIES, resetLocalData, settingsStore, type DisplayCurrency } from '@/stores'

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="border-t border-line px-5 py-5 sm:px-6">{children}</div>
    </Card>
  )
}

export default function Settings() {
  const settings = settingsStore.use()
  const session = useSession()
  const fx = useFx()
  const { logout, user } = usePrivy()
  const { wallets } = useWallets()
  const { setActiveWallet } = useSetActiveWallet()
  const [confirmReset, setConfirmReset] = useState(false)
  const update = <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) => settingsStore.set((s) => ({ ...s, [key]: value }))

  let thresholdError: string | null = null
  if (settings.largeTransferThreshold.trim()) {
    try {
      if (!parseAmount(session.network.chainId, settings.largeTransferThreshold).isPositive()) thresholdError = 'Enter an amount greater than zero, or leave empty to turn off.'
    } catch {
      thresholdError = 'Enter a valid amount, or leave empty to turn off.'
    }
  }

  return (
    <>
      <PageHeader title="Settings" description="Display and safety preferences are saved on this device. Sign-in and your wallet are managed by Privy." />

      <div className="mx-auto max-w-3xl space-y-6">
        <Section title="Profile" description="Shown to people who open your payment links.">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Display name" value={settings.displayName} maxLength={60} onChange={(e) => update('displayName', e.target.value)} placeholder="Alex Rivera" />
            <TextField label="Business name" optional value={settings.businessName} maxLength={60} onChange={(e) => update('businessName', e.target.value)} placeholder="Rivera Studio" hint="Replaces your name on payment links." />
          </div>
        </Section>

        <Section title="Wallet and sign-in" description="Cooket never holds your keys. Privy manages sign-in and your wallet, and your wallet approves every payment.">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <Badge tone="success">Signed in</Badge>
                {(user?.email?.address ?? user?.google?.email) && <p className="mt-2 text-sm text-slate-700">{user?.email?.address ?? user?.google?.email}</p>}
              </div>
              <Button onClick={() => void logout()}>Sign out</Button>
            </div>
            {session.address && (
              <div>
                <p className="text-xs text-muted">Active wallet</p>
                <div className="mt-1 flex items-center gap-1">
                  <Address value={session.address} full className="text-[13px]" />
                  <CopyButton value={session.address} label="Copy wallet address" iconOnly />
                </div>
                <ExternalAnchor href={buildAddressExplorerUrl(session.network.chainId, session.address)} className="mt-1 text-sm">
                  View on explorer
                </ExternalAnchor>
              </div>
            )}
            {wallets.length > 1 && (
              <div>
                <p className="mb-2 text-sm font-medium text-ink">Your wallets</p>
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {wallets.map((w) => {
                    const active = w.address.toLowerCase() === session.address?.toLowerCase()
                    return (
                      <li key={w.address} className="flex items-center justify-between gap-3 px-3.5 py-3">
                        <span className="min-w-0">
                          <Address value={w.address} />
                          <span className="block text-xs text-muted">{w.walletClientType === 'privy' ? 'Privy embedded wallet' : w.walletClientType}</span>
                        </span>
                        {active ? <Badge tone="success">Active</Badge> : <Button size="sm" onClick={() => void setActiveWallet(w)}>Use this wallet</Button>}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {session.wrongNetwork && <Notice tone="warning" title="Wallet is not on Arc Mainnet">Switch your wallet to Arc Mainnet from the network menu in the top bar before sending.</Notice>}
          </div>
        </Section>

        <Section title="Display" description="Fiat values are estimates for reference only.">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Preferred currency"
              value={settings.currency}
              onChange={(e) => update('currency', e.target.value as DisplayCurrency)}
              hint={
                fx.isFallback
                  ? 'The exchange rate is unavailable right now, so amounts show in USD.'
                  : 'Assumes 1 USDC = 1 USD, converted at a public reference rate.'
              }
            >
              {DISPLAY_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="mt-2 divide-y divide-line">
            <Toggle label="Hide balances" description="Mask balances and totals across the app." checked={settings.hideBalance} onChange={(v) => update('hideBalance', v)} />
          </div>
        </Section>

        <Section title="Notifications" description="Alerts appear in the bell menu and as short messages while Cooket is open.">
          <div className="divide-y divide-line">
            <Toggle label="Incoming payments" description="Tell me when USDC arrives in my wallet." checked={settings.notifyIncoming} onChange={(v) => update('notifyIncoming', v)} />
            <Toggle label="Payment results" description="Tell me when a payment I sent is confirmed or fails." checked={settings.notifyOutgoing} onChange={(v) => update('notifyOutgoing', v)} />
          </div>
          <p className="mt-3 text-sm text-muted">Cooket cannot notify you while the app is closed. Email and push alerts are not available.</p>
        </Section>

        <Section title="Security" description="Checks Cooket applies before a payment is sent.">
          <div className="divide-y divide-line">
            <div className="flex items-center justify-between gap-4 py-3.5">
              <div>
                <p className="text-sm font-medium text-ink">Review and confirm every payment</p>
                <p className="mt-0.5 text-sm text-muted">Every send shows a review step and an explicit confirmation, then your wallet asks you to sign.</p>
              </div>
              <Badge tone="success">
                <Check className="size-3.5" aria-hidden />
                Always on
              </Badge>
            </div>
            <Toggle label="Warn about new recipients" description="Show a warning for addresses you have never paid and have not saved." checked={settings.warnNewRecipients} onChange={(v) => update('warnNewRecipients', v)} />
            <div className="py-3.5">
              <TextField
                label="Large transfer threshold (USDC)"
                inputMode="decimal"
                value={settings.largeTransferThreshold}
                onChange={(e) => update('largeTransferThreshold', e.target.value.replace(/[^0-9.]/g, ''))}
                error={thresholdError}
                hint="Payments at or above this amount need an extra confirmation. Leave empty to turn off."
                className="sm:max-w-xs"
              />
            </div>
          </div>
          <p className="mt-3 text-sm text-muted">Passkeys, two-factor sign-in, and spending limits are not part of Cooket. Your wallet controls signing.</p>
        </Section>

        <Section title="Network" description="Cooket works on Arc Mainnet only. Payments move real USDC and cannot be reversed.">
          <dl className="divide-y divide-line text-sm">
            <div className="flex justify-between gap-4 py-2.5"><dt className="text-muted">Network</dt><dd className="font-medium text-ink">{session.network.name}</dd></div>
            <div className="flex justify-between gap-4 py-2.5"><dt className="text-muted">Chain ID</dt><dd className="num font-medium text-ink">{session.network.chainId}</dd></div>
            <div className="flex justify-between gap-4 py-2.5"><dt className="text-muted">Fees paid in</dt><dd className="font-medium text-ink">USDC</dd></div>
            <div className="flex items-center justify-between gap-4 py-2.5"><dt className="text-muted">USDC contract</dt><dd className="flex items-center gap-1"><Address value={session.network.usdcAddress} /><CopyButton value={session.network.usdcAddress} label="Copy USDC contract" iconOnly /></dd></div>
          </dl>
        </Section>

        <Section title="Local data" description="Contacts, notes, preferences, and sent-payment records live in this browser only. Payment links are stored on the Cooket payment server.">
          <Button variant="danger" onClick={() => setConfirmReset(true)}>
            Erase local data
          </Button>
        </Section>
      </div>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Erase local data?"
        description="This removes contacts, notes, and notifications from this browser. Your wallet and onchain payments are not affected."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                resetLocalData()
                setConfirmReset(false)
                toast.success('Local data erased')
              }}
            >
              Erase data
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted">Payment links on the Cooket payment server are not affected.</p>
      </Modal>
    </>
  )
}
