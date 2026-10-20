/**
 * The search seat: the one provider this plugin registers in `ctx.web`.
 *
 * The profile bundle selects the seat in the shared `web` row; the seat hands
 * every call to the backend `select` returns for that call. The planner freezes
 * the Session connection per model request step, while checking current
 * operational policy before each execution.
 */
import type { WebSearchProvider } from '@deepseek-ai/dsh-web'

/**
 * @param id - the id registered in `ctx.web`.
 * @param select - picks the backend for one call; must not do I/O.
 * @returns the provider `ctx.web` calls.
 */
export function createSearchSeat(id: string, select: () => WebSearchProvider): WebSearchProvider {
  return {
    id,
    // Whether a Session can search depends on its selection, known only at call time.
    available: () => true,
    search: (request, signal) => select().search(request, signal),
  }
}
