import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Search, Send, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button, IconButton } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { TextField } from '@/components/ui/Field'
import { Address, CopyButton, EmptyState } from '@/components/ui/misc'
import { checkAddress } from '@/domain/address'
import type { Contact } from '@/domain/types'
import { navigate, useLocation } from '@/lib/router'
import { randomId } from '@/lib/store'
import { contactsStore } from '@/stores'

interface FormState {
  id?: string
  name: string
  address: string
  note: string
}

const EMPTY: FormState = { name: '', address: '', note: '' }

function ContactForm({ initial, contacts, onClose }: { initial: FormState; contacts: Contact[]; onClose: () => void }) {
  const [form, setForm] = useState(initial)
  const [touched, setTouched] = useState(false)

  const check = checkAddress(form.address)
  const duplicate = check.ok ? contacts.find((c) => c.address.toLowerCase() === check.address.toLowerCase() && c.id !== form.id) : undefined
  const nameError = touched && !form.name.trim() ? 'Enter a name.' : null
  const addressError = (touched || form.address) && !check.ok ? check.error : duplicate ? `Already saved as ${duplicate.name}.` : null

  const save = () => {
    setTouched(true)
    if (!form.name.trim() || !check.ok || duplicate) return
    const next: Contact = {
      id: form.id ?? randomId(),
      name: form.name.trim(),
      address: check.address,
      note: form.note.trim() || undefined,
      createdAt: contacts.find((c) => c.id === form.id)?.createdAt ?? Date.now(),
    }
    contactsStore.set((prev) => (form.id ? prev.map((c) => (c.id === form.id ? next : c)) : [next, ...prev]))
    toast.success(form.id ? 'Contact updated' : 'Contact saved')
    onClose()
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <TextField label="Name" value={form.name} maxLength={60} autoComplete="off" onChange={(e) => setForm({ ...form, name: e.target.value })} error={nameError} placeholder="Maya Okafor" />
      <TextField
        label="Wallet address"
        mono
        value={form.address}
        autoComplete="off"
        spellCheck={false}
        placeholder="0x…"
        onChange={(e) => setForm({ ...form, address: e.target.value.trim() })}
        error={addressError}
        hint={check.ok ? 'Valid EVM address.' : undefined}
      />
      <TextField label="Note" optional value={form.note} maxLength={80} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Designer, pays on the 1st" />
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary">
          {form.id ? 'Save changes' : 'Save contact'}
        </Button>
      </div>
    </form>
  )
}

export default function Contacts() {
  const contacts = contactsStore.use()
  const { params } = useLocation()
  const [query, setQuery] = useState('')
  const addParam = params.get('add')
  const [editing, setEditing] = useState<FormState | null>(() => (addParam ? { ...EMPTY, address: addParam } : null))
  const [removing, setRemoving] = useState<Contact | null>(null)

  // /contacts?add=0x… opened the form prefilled (used after a payment to save the recipient). Clear it from the URL.
  useEffect(() => {
    if (addParam) navigate('/contacts', { replace: true })
  }, [addParam])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? contacts.filter((c) => [c.name, c.address, c.note].some((v) => v?.toLowerCase().includes(q))) : contacts
  }, [contacts, query])

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Save the people and businesses you pay, so sending takes two taps. Contacts are stored on this device only."
        actions={
          <Button variant="primary" icon={<Plus className="size-5" aria-hidden />} onClick={() => setEditing(EMPTY)}>
            Add contact
          </Button>
        }
      />

      <Card>
        {contacts.length > 0 && (
          <div className="relative border-b border-line p-4 sm:px-6">
            <Search className="pointer-events-none absolute left-7 top-1/2 size-4 -translate-y-1/2 text-muted sm:left-9" aria-hidden />
            <input
              aria-label="Search contacts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, address, or note"
              className="h-11 w-full rounded-control border border-line bg-surface pl-10 pr-3 text-base focus:border-brand focus:ring-2 focus:ring-brand/20 sm:text-sm"
            />
          </div>
        )}

        {contacts.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" aria-hidden />}
            title="No contacts yet"
            description="Add a name and wallet address. Cooket checks the address before you can save it."
            action={<Button variant="primary" onClick={() => setEditing(EMPTY)}>Add your first contact</Button>}
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Search className="size-6" aria-hidden />} title="No matches" description={`No contact matches “${query}”.`} action={<Button onClick={() => setQuery('')}>Clear search</Button>} />
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-4 sm:flex-nowrap sm:px-6">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand">{c.name.slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
                  <div className="flex items-center gap-1">
                    <Address value={c.address} className="text-xs text-muted" />
                    <CopyButton value={c.address} label="Copy address" iconOnly className="size-8" />
                  </div>
                  {c.note && <p className="truncate text-xs text-muted">{c.note}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="primary" icon={<Send className="size-4" aria-hidden />} onClick={() => navigate(`/send?to=${c.address}`)}>
                    Send
                  </Button>
                  <IconButton label={`Edit ${c.name}`} onClick={() => setEditing({ id: c.id, name: c.name, address: c.address, note: c.note ?? '' })}>
                    <Pencil className="size-4" aria-hidden />
                  </IconButton>
                  <IconButton label={`Remove ${c.name}`} onClick={() => setRemoving(c)}>
                    <Trash2 className="size-4" aria-hidden />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.id ? 'Edit contact' : 'Add contact'}>
        {editing && <ContactForm initial={editing} contacts={contacts} onClose={() => setEditing(null)} />}
      </Modal>

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove contact?"
        description={removing ? `${removing.name} will be removed from this device. Past payments are not affected.` : undefined}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => setRemoving(null)}>Keep contact</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (removing) contactsStore.set((prev) => prev.filter((c) => c.id !== removing.id))
                toast.success('Contact removed')
                setRemoving(null)
              }}
            >
              Remove
            </Button>
          </div>
        }
      >
        {removing && <Address value={removing.address} full className="text-xs" />}
      </Modal>
    </>
  )
}
