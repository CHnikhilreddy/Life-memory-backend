/**
 * Lightweight in-memory error tracker.
 * Keeps the last MAX_ERRORS errors in a ring buffer.
 * Queryable via GET /api/admin/errors (requires ADMIN_SECRET).
 */

interface TrackedError {
  id: number
  timestamp: string
  message: string
  stack?: string
  source: 'route' | 'middleware' | 'uncaught' | 'unhandled-rejection'
  method?: string
  path?: string
  requestId?: string
}

const MAX_ERRORS = 100
const errors: TrackedError[] = []
let nextId = 1

export function trackError(
  err: Error | string,
  source: TrackedError['source'],
  context?: { method?: string; path?: string; requestId?: string }
) {
  const entry: TrackedError = {
    id: nextId++,
    timestamp: new Date().toISOString(),
    message: typeof err === 'string' ? err : err.message,
    stack: typeof err === 'string' ? undefined : err.stack,
    source,
    ...context,
  }

  errors.push(entry)
  if (errors.length > MAX_ERRORS) {
    errors.shift()
  }
}

export function getErrors(options?: { source?: string; limit?: number; since?: string }): TrackedError[] {
  let result = [...errors]

  if (options?.source) {
    result = result.filter(e => e.source === options.source)
  }
  if (options?.since) {
    result = result.filter(e => e.timestamp >= options.since!)
  }

  result.reverse() // newest first

  if (options?.limit) {
    result = result.slice(0, options.limit)
  }

  return result
}

export function getErrorStats() {
  const now = Date.now()
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString()
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString()

  return {
    total: errors.length,
    lastHour: errors.filter(e => e.timestamp >= oneHourAgo).length,
    last24h: errors.filter(e => e.timestamp >= oneDayAgo).length,
    bySource: {
      route: errors.filter(e => e.source === 'route').length,
      middleware: errors.filter(e => e.source === 'middleware').length,
      uncaught: errors.filter(e => e.source === 'uncaught').length,
      'unhandled-rejection': errors.filter(e => e.source === 'unhandled-rejection').length,
    },
    oldest: errors[0]?.timestamp ?? null,
    newest: errors[errors.length - 1]?.timestamp ?? null,
  }
}
