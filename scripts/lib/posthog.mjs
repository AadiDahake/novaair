/**
 * The PostHog endpoints the seeding and verification scripts use.
 *
 * PostHog splits its API across two hosts. The private API, which the query endpoint and the
 * session recording endpoints live on, needs a personal API key and answers on `POSTHOG_HOST`
 * (`https://us.posthog.com` on US Cloud). The public capture endpoints take the project token in
 * the body instead and answer on the ingestion host (`https://us.i.posthog.com`).
 *
 * Nothing here prints a key.
 */

const DEFAULT_HOST = 'https://us.posthog.com'
const DEFAULT_INGEST_HOST = 'https://us.i.posthog.com'

/** The private API settings, or an explanation of which name is missing. */
export function readPrivateApiEnv(env = process.env) {
  const host = (env.POSTHOG_HOST ?? DEFAULT_HOST).replace(/\/$/, '')
  const projectId = env.POSTHOG_PROJECT_ID
  const personalApiKey = env.POSTHOG_PERSONAL_API_KEY
  const missing = []
  if (!projectId) missing.push('POSTHOG_PROJECT_ID')
  if (!personalApiKey) missing.push('POSTHOG_PERSONAL_API_KEY')
  return { host, projectId, personalApiKey, missing }
}

/** The public capture settings, or an explanation of which name is missing. */
export function readCaptureEnv(env = process.env) {
  const ingestHost = (env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_INGEST_HOST).replace(/\/$/, '')
  const projectToken = env.NEXT_PUBLIC_POSTHOG_KEY
  return { ingestHost, projectToken, missing: projectToken ? [] : ['NEXT_PUBLIC_POSTHOG_KEY'] }
}

/**
 * Run one HogQL query.
 *
 * `name` lands in PostHog's own `query_log`, which is the only way to tell these queries apart
 * from the product's when one of them is slow, so it is required rather than optional.
 *
 * `refresh` defaults to `force_blocking`, because PostHog caches a result against the text of the
 * query. The verification runs the same text every time, so the default `blocking` can answer
 * from a cache filled while a seeding run was still part way through.
 */
export async function runQuery(
  { host, projectId, personalApiKey },
  name,
  query,
  refresh = 'force_blocking',
) {
  const response = await fetch(`${host}/api/projects/${projectId}/query/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${personalApiKey}` },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query }, name, refresh }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = body.detail ?? body.error ?? JSON.stringify(body).slice(0, 400)
    throw new Error(`query "${name}" failed with ${response.status}: ${detail}`)
  }
  const columns = body.columns ?? []
  const results = body.results ?? []
  return {
    columns,
    results,
    rows: results.map((row) => Object.fromEntries(columns.map((column, i) => [column, row[i]]))),
  }
}

/** Does a session replay exist for this session id? The recording id is the session id. */
export async function getRecording({ host, projectId, personalApiKey }, sessionId) {
  const response = await fetch(`${host}/api/projects/${projectId}/session_recordings/${sessionId}/`, {
    headers: { authorization: `Bearer ${personalApiKey}` },
  })
  if (response.status === 404) return null
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`recording lookup failed with ${response.status}`)
  return body
}

/** The link that opens one session in PostHog's replay viewer. */
export function replayUrl({ host, projectId }, sessionId) {
  return `${host}/project/${projectId}/replay/${sessionId}`
}

/**
 * Send events to the public capture endpoint.
 *
 * The whole request body must stay under 20 MB, so callers send in chunks. `historicalMigration`
 * stays false: PostHog gates the true setting behind a paid plan and requires every timestamp to
 * be at least 48 hours old.
 */
export async function captureBatch(
  { ingestHost, projectToken },
  batch,
  { historicalMigration = false } = {},
) {
  const response = await fetch(`${ingestHost}/batch/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: projectToken,
      historical_migration: historicalMigration,
      batch,
    }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`capture failed with ${response.status}: ${text.slice(0, 300)}`)
  return text
}
