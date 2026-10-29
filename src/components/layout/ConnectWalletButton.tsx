import { usePrivy } from '@privy-io/react-auth'
import { LogIn } from 'lucide-react'
import { Button } from '@/components/ui/Button'

/** Opens Privy sign-in (email, Google, or an existing wallet). */
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
  const { login, ready } = usePrivy()
  return (
    <Button variant={variant} size={size} full={full} disabled={!ready} onClick={() => login()} icon={<LogIn className="size-4" aria-hidden />}>
      {label}
    </Button>
  )
}
