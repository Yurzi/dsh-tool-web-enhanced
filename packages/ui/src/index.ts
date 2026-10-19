/**
 * Host face of the shared composer connection menu. It is empty on purpose:
 * DSH loads a package's browser face only for a mounted row, so the menu
 * needs a row, but it owns no Host behaviour.
 *
 * The row depends on nothing either plugin provides. Search and fetch
 * register their menu sections into its browser service through optional
 * injection, so this row stays healthy with either plugin row, both, or
 * neither enabled. The browser face (`webConnections` service, menu,
 * activation prompt, bundle overview) arrives with milestone M1; see
 * docs/architecture.md, section 9.
 * @module dsh-tool-web-enhanced-ui
 */
import { UI } from 'dsh-tool-web-enhanced-core/shared'

/** Cordis plugin name used in Loader diagnostics; equal to the row id. */
export const name = UI.rowId

/** Mounting the row is all the Host needs. */
export function apply(): void {}
