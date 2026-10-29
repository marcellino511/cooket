import { useMemo, useState } from 'react'
import { ArrowRight, ClipboardPaste, Search, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Address, CopyButton, Notice, Skeleton } from '@/components/ui/misc'
import { shortAddress } from '@/lib/format'
import { Link } from '@/lib/router'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { cn } from '@/lib/cn'
import type { SendFlow } from './useSendFlow'

export function RecipientStep({ flow }: { flow: SendFlow }) {
  const { addressCheck, recipientInput, setRecipientInput, recipient, contact, contacts, recipientInfo, isSelf, session } = flow
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? contacts.filter((c) => c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q)) : contacts
  }, [contacts, query])

  const touched = recipientInput.trim().length > 0
  const error = touched && !addressCheck.ok ? addressCheck.error : null
  const blockedRecipient = isSelf || Boolean(recipientInfo.data?.isUsdcContract)

  return (
    <div className="space-y-6">
      <TextField
        label="Recipient wallet address"
        placeholder="0x…"
        mono
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={recipientInput}
        onChange={(e) => setRecipientInput(e.target.value.trim())}
        error={error}
        hint={`Paste an EVM address. Funds are sent as USDC on ${session.network.name}.`}
        trailing={
          <button
            type="button"
            aria-label="Paste from clipboard"
            title="Paste from clipboard"
            onClick={() => {
              navigator.clipboard
                .readText()
                .then((text) => setRecipientInput(text.trim()))
                .catch(() => undefined) // permission denied: the user can paste manually
            }}
            className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-slate-100 hover:text-ink"
          >
            <ClipboardPaste className="size-4" aria-hidden />
          </button>
        }
      />

      {recipient && (
        <div className="rounded-xl border border-line bg-slate-50 p-4" aria-live="polite">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">{contact ? contact.name : 'New recipient'}</p>
              <p className="mt-1 break-all font-mono text-[13px] text-muted">{recipient}</p>
            </div>
            <CopyButton value={recipient} label="Copy recipient address" iconOnly />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <a className="font-medium text-brand hover:text-brand-hover" href={buildAddressExplorerUrl(session.network.chainId, recipient)} target="_blank" rel="noopener noreferrer">
              View on explorer
            </a>
            {recipientInfo.isLoading ? (
              <Skeleton className="h-4 w-40" />
            ) : recipientInfo.data ? (
              <span className="text-muted">{recipientInfo.data.isContract ? 'Smart contract on this network' : 'Regular wallet on this network'}</span>
            ) : (
              <span className="text-muted">Could not inspect this address on {session.network.name}</span>
            )}
          </div>
        </div>
      )}

      {isSelf && <Notice tone="danger" title="This is your own address">Choose a different recipient.</Notice>}
      {recipientInfo.data?.isUsdcContract && <Notice tone="danger" title="This is the USDC token contract">Sending USDC to it would lose the funds. Choose a wallet address.</Notice>}
      {recipientInfo.data?.isContract && !recipientInfo.data.isUsdcContract && (
        <Notice tone="warning" title="Smart contract recipient">
          Make sure this contract can receive and move USDC. You will see this warning again before you sign.
        </Notice>
      )}

      <section aria-label="Saved contacts">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Saved contacts</h3>
          <Link to="/contacts" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:text-brand-hover">
            <UserPlus className="size-4" aria-hidden />
            Manage
          </Link>
        </div>
        {contacts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">No saved contacts yet. Add the people you pay often and pick them here.</p>
        ) : (
          <>
            {contacts.length > 4 && (
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  aria-label="Search contacts"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search contacts"
                  className="h-11 w-full rounded-control border border-line bg-surface pl-9 pr-3 text-base focus:border-brand focus:ring-2 focus:ring-brand/20 sm:text-sm"
                />
              </div>
            )}
            <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-xl border border-line">
              {filtered.map((c) => {
                const selected = recipient?.toLowerCase() === c.address.toLowerCase()
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setRecipientInput(c.address)}
                      aria-pressed={selected}
                      className={cn('flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-slate-50', selected && 'bg-brand-50')}
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                        {c.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                        <Address value={c.address} className="text-xs text-muted" />
                      </span>
                      {selected && <span className="text-xs font-medium text-brand">Selected</span>}
                    </button>
                  </li>
                )
              })}
              {filtered.length === 0 && <li className="p-4 text-sm text-muted">No contact matches “{query}”.</li>}
            </ul>
          </>
        )}
      </section>

      <Button
        variant="primary"
        size="lg"
        full
        disabled={!recipient || blockedRecipient}
        onClick={() => flow.setStep('amount')}
        icon={<ArrowRight className="size-5" aria-hidden />}
      >
        {recipient ? `Continue with ${contact ? contact.name : shortAddress(recipient)}` : 'Continue'}
      </Button>
    </div>
  )
}
