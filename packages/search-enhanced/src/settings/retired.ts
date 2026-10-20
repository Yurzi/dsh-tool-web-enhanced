/** Only exposes retired fields to the browser so Reset can remove them; resolveSettings still rejects them. */
export const RETIRED_FIELDS = ["providerId","freshness","modelMode","protocol","baseURL","model","fallbackModel","apiKey","apiKeyEnv","apiVersion","toolIdentifier","maxTokens","maxUses","chatSearchMode","searchContextSize"] as const
