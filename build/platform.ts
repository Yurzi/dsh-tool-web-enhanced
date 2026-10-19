/**
 * Modules the DSH web shell shares with every client bundle through its module
 * table (deepseek-harness packages/client/web/src/platform.ts). A client half
 * may import these at runtime; everything else is inlined into lib/client.js.
 */
export const PLATFORM_MODULES: readonly string[] = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  'zod', '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** Whether a client import resolves from the shell's module table. */
export const isPlatformModule = (specifier: string): boolean => PLATFORM_MODULES.includes(specifier)
