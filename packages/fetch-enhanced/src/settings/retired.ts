/** Only exposes retired fields to the browser so Reset can remove them; resolveSettings still rejects them. */
export const RETIRED_FIELDS = ["schemaVersion","providerId","allowCidrs","allowHostnames","userAgent","maxResponseBytes","maxBodyChars","timeoutMs","maxRedirects"] as const
