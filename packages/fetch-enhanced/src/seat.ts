/**
 * The fetch seat: the one provider this plugin registers in `ctx.web`.
 *
 * The profile bundle selects the seat in the shared `web` row; the seat hands
 * every call to the backend `select` returns for that call. M0 always returns
 * the local backend; the planner (the Session's connection, frozen per model
 * request step — the same paradigm as search) replaces `select` without
 * touching this registration. See docs/architecture.md, section 6.
 */
import type { WebFetchProvider } from '@deepseek-ai/dsh-web'

/**
 * @param id - the id registered in `ctx.web`.
 * @param select - picks the backend for one call; must not do I/O.
 * @returns the provider `ctx.web` calls.
 */
export function createFetchSeat(id: string, select: () => WebFetchProvider): WebFetchProvider {
  return {
    id,
    // Whether a Session can fetch depends on its selection, known only at call time.
    available: () => true,
    fetch: (request, signal) => select().fetch(request, signal),
  }
}
