import { isRecord, toolJson, toolTexts, type McpToolResult } from 'dsh-tool-web-enhanced-core/host'

const NO_RESULTS = /^No (?:search )?results (?:found|returned)/iu

/**
 * Rows of a tool result: structured content, or JSON in a text part. An
 * explicit "no results" text is an empty list; an unrecognized result is undefined.
 */
export function toolRows(result: McpToolResult): readonly unknown[] | undefined {
  const structured = rowsOf(result.structuredContent)
  if (structured !== undefined) return structured
  let recognized = false
  const rows: unknown[] = []
  for (const part of toolTexts(result)) {
    const content = toolJson(part)
    const parsed = content.kind === 'json' ? rowsOf(content.value) : undefined
    if (parsed !== undefined) rows.push(...parsed)
    if (parsed !== undefined || NO_RESULTS.test(part.trim())) recognized = true
  }
  return recognized ? rows : undefined
}

function rowsOf(value: unknown): readonly unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (!isRecord(value)) return undefined
  const data = value.data
  for (const candidate of [value.results, value.web, isRecord(data) ? data.web : undefined, data]) {
    if (Array.isArray(candidate)) return candidate
  }
  return undefined
}

