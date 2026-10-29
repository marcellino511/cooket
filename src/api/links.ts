import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePrivy } from '@privy-io/react-auth'
import type { CreateLinkInput, LinkPayment, MerchantLink, PublicLink } from '@/shared/links'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'The Cooket payment server is not reachable.', 'unreachable')
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string }
  if (!response.ok) throw new ApiError(response.status, body.error ?? 'Request failed.', body.code ?? 'error')
  return body as T
}

export interface CreateLinkBody extends CreateLinkInput {
  signature: `0x${string}`
}

export const linksApi = {
  get: (id: string) => request<PublicLink>(`/links/${encodeURIComponent(id)}`),
  list: (token: string) => request<{ links: MerchantLink[] }>('/links', {}, token).then((r) => r.links),
  create: (token: string, body: CreateLinkBody) => request<PublicLink>('/links', { method: 'POST', body: JSON.stringify(body) }, token),
  deactivate: (token: string, id: string) => request<PublicLink>(`/links/${encodeURIComponent(id)}/deactivate`, { method: 'POST' }, token),
  verifyPayment: (id: string, txHash: string) =>
    request<{ verified: true; payment: LinkPayment }>(`/links/${encodeURIComponent(id)}/payments`, { method: 'POST', body: JSON.stringify({ txHash }) }),
}

/** A fresh Privy access token for authenticated calls. */
export function useAuthToken() {
  const { getAccessToken } = usePrivy()
  return useCallback(async () => {
    const token = await getAccessToken()
    if (!token) throw new ApiError(401, 'Your session expired. Sign in again.', 'unauthorized')
    return token
  }, [getAccessToken])
}

export function usePublicLink(id: string | null) {
  return useQuery({
    queryKey: ['public-link', id],
    enabled: Boolean(id),
    retry: (count, error) => !(error instanceof ApiError && error.status < 500 && error.status !== 0) && count < 1,
    queryFn: () => linksApi.get(id ?? ''),
  })
}

export function useMyLinks() {
  const { authenticated } = usePrivy()
  const token = useAuthToken()
  return useQuery({
    queryKey: ['my-links'],
    enabled: authenticated,
    refetchInterval: 20_000,
    retry: 1,
    queryFn: async () => linksApi.list(await token()),
  })
}
