import { useState } from 'react'
import { useLogin, usePrivy } from '@privy-io/react-auth'
import { LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'

/** Plain-language messages for sign-in failures. Closing the modal is a cancellation, not an error. */
function loginErrorMessage(code: string): string | null {
  switch (code) {
    case 'exited_auth_flow':
      return null
    case 'oauth_user_denied':
      return 'You declined access, so you were not signed in.'
    case 'oauth_account_suspended':
      return 'That account is suspended and cannot be used to sign in.'
    case 'linked_to_another_user':
      return 'That account is already linked to another Cooket profile. Sign in with the method you used first.'
    case 'allowlist_rejected':
      return 'This account is not allowed to sign in.'
    default:
      return 'Sign-in did not complete. Try again, or choose another method.'
  }
}

/** Opens Privy sign-in (email, Google, X, or an existing wallet). */
export function ConnectWalletButton({
  variant = 'primary',
  size = 'md',
  full,
  label = 'Sign in',
}: {
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'md' | 'lg'
  full?: boolean
  label?: string
}) {
  const { ready } = usePrivy()
  const [opening, setOpening] = useState(false)
  const { login } = useLogin({
    onComplete: () => setOpening(false),
    onError: (code) => {
      setOpening(false)
      const message = loginErrorMessage(String(code))
      if (message) toast.error(message)
    },
  })
  return (
    <Button
      variant={variant}
      size={size}
      full={full}
      disabled={!ready}
      loading={opening}
      onClick={() => {
        setOpening(true)
        login()
      }}
      icon={<LogIn className="size-4" aria-hidden />}
    >
      {label}
    </Button>
  )
}
