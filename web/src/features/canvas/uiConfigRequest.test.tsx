import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requestUiConfig, UiConfigRequestError } from './uiConfigRequest'

test('configuration failures distinguish missing backend routes, server errors, and network errors', async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const [status, reason] of [[404, 'missing'], [500, 'server']] as const) {
      globalThis.fetch = async () => new Response('error', { status })
      await assert.rejects(requestUiConfig('http://backend/ui-config'), (error: unknown) =>
        error instanceof UiConfigRequestError && error.reason === reason && error.status === status)
    }
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
    await assert.rejects(requestUiConfig('http://backend/ui-config'), (error: unknown) =>
      error instanceof UiConfigRequestError && error.reason === 'network')
    globalThis.fetch = async () => new Response('<html>Not JSON</html>')
    await assert.rejects(requestUiConfig('http://backend/ui-config'), (error: unknown) =>
      error instanceof UiConfigRequestError && error.reason === 'invalid')
  } finally {
    globalThis.fetch = originalFetch
  }
})
