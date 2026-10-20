import type { UiConfig } from './uiConfig'

export class UiConfigRequestError extends Error {
  constructor(public readonly reason: 'missing' | 'network' | 'server' | 'invalid', public readonly status?: number) {
    super(`Configuration request failed: ${reason}${status ? ` (${status})` : ''}`)
  }
}

export async function requestUiConfig(url: string, init?: RequestInit): Promise<UiConfig> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init?.signal?.aborted) throw error
    throw new UiConfigRequestError('network')
  }
  if (!response.ok) {
    throw new UiConfigRequestError(response.status === 404 ? 'missing' : 'server', response.status)
  }
  try {
    return await response.json() as UiConfig
  } catch {
    throw new UiConfigRequestError('invalid')
  }
}
