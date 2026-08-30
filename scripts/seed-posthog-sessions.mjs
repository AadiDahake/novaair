#!/usr/bin/env node
/**
 * Record real NovaAir sessions in PostHog.
 *
 * A browser drives the running site with `posthog-js` live, so PostHog assigns every session its
 * own `$session_id`, stores a session replay for it, and receives the site's own events. The
 * capture API could post the same events far faster, but it cannot produce a replay, and the
 * replay is the evidence a person watches.
 *
 * The plan for each session is in `scripts/lib/synth-sessions.ts`, which is deterministic, so
 * `--dry-run` prints exactly what a real run would play.
 *
 *   node --import tsx scripts/seed-posthog-sessions.mjs [--dry-run] [--workers 4]
 *                                                       [--limit N] [--from N] [--restart]
 *
 * PostHog keeps everything it is sent, so run it once. If it stops part way, run it again: the
 * finished sessions are in `.posthog-seed-progress.jsonl` and are skipped.
 */
import { appendFile, readFile } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from '@playwright/test'
import { createPool } from './lib/db.mjs'
import { resetInPostgres, resetOverHttp } from './lib/demo-reset.mjs'
import { loadEnv } from './lib/env.mjs'
import { median, planSessions } from './lib/synth-sessions.ts'
import { DEMO_LAST_NAME, DEMO_RESERVATION } from '../lib/seats/demo-data.ts'
import {
  confirmSeats,
  findReservation,
  openSeatMap,
  openSeatsSection,
  selectPassenger,
  selectSeat,
} from '../e2e/helpers.ts'

loadEnv()

const PROGRESS_FILE = '.posthog-seed-progress.jsonl'

/** How long the pointer rests on a seat. Above the 400 ms `seat_hovered` throttle. */
const HOVER_MS = 550
/** How long a customer takes between clicks. */
const CLICK_MS = 420
/** Quiet time at the end of a session, so the replay's last batch reaches PostHog. */
const SETTLE_MS = 8_000

/**
 * Who to look the booking up as.
 *
 * The demo reservation is defined once, in `lib/seats/demo-data.ts`, so a rename of the party
 * reaches this run without an edit here. The environment can still override both, for a site
 * seeded with a different booking. No first name is ever typed, so the party can be renamed
 * freely.
 */
const LOOKUP_CODE = process.env.NOVAAIR_DEMO_CODE ?? DEMO_RESERVATION.code
const LOOKUP_LAST_NAME = process.env.NOVAAIR_DEMO_LAST_NAME ?? DEMO_LAST_NAME

/**
 * `posthog-js` drops every event from anything that looks automated: it checks
 * `navigator.webdriver` and looks for "headlesschrome" in the user agent and in the user agent
 * client hints. A synthetic customer has to present itself as an ordinary browser, or PostHog
 * accepts the page load and records nothing at all.
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const BRANDS = [
  { brand: 'Chromium', version: '141' },
  { brand: 'Google Chrome', version: '141' },
  { brand: 'Not?A_Brand', version: '8' },
]

function parseArgs(argv) {
  const args = { dryRun: false, workers: 4, limit: Number.POSITIVE_INFINITY, from: 1, restart: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--restart') args.restart = true
    else if (arg === '--workers') args.workers = Number(argv[(i += 1)])
    else if (arg === '--limit') args.limit = Number(argv[(i += 1)])
    else if (arg === '--from') args.from = Number(argv[(i += 1)])
    else {
      console.error(`unknown option: ${arg}`)
      process.exit(2)
    }
  }
  return args
}

/** Runs one task at a time, in call order. */
function createMutex() {
  let tail = Promise.resolve()
  return function run(task) {
    const result = tail.then(task, task)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function readProgress() {
  const text = await readFile(PROGRESS_FILE, 'utf8').catch(() => '')
  const done = new Map()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line)
      done.set(record.index, record)
    } catch {
      // A half-written line means the run was killed. Replaying that session is the safe answer.
    }
  }
  return done
}

/**
 * Put the booking back on 12A, 18C and 24F.
 *
 * The in-memory store can only be reset from inside the server it lives in, which is what the
 * endpoint is for. The Supabase store is a database, so the reset writes to it. The site says
 * which one it is on, so the caller does not have to.
 */
function createReset(baseUrl, pool) {
  return async function resetBooking() {
    if (await resetOverHttp(baseUrl)) return 'endpoint'
    if (!pool) {
      throw new Error(
        `The site at ${baseUrl} is not on the in-memory store, and SUPABASE_DB_URL is not set. ` +
          'The booking cannot be put back between sessions. See .env.example.',
      )
    }
    const client = await pool.connect()
    try {
      await resetInPostgres(client, { seatStates: false })
      return 'database'
    } finally {
      client.release()
    }
  }
}

async function readSessionId(context, page, token) {
  const fromSdk = await page
    .evaluate(() => globalThis.posthog?.get_session_id?.() ?? null)
    .catch(() => null)
  if (fromSdk) return fromSdk
  const cookie = (await context.cookies()).find((entry) => entry.name === `ph_${token}_posthog`)
  if (!cookie) return null
  try {
    const stored = JSON.parse(decodeURIComponent(cookie.value))
    return Array.isArray(stored.$sesid) ? (stored.$sesid[1] ?? null) : null
  } catch {
    return null
  }
}

/** Play one step of the plan against the seat map. */
async function playStep(page, step) {
  if (step.kind === 'hover') {
    await page.locator(`[data-seat="${step.seat}"]`).hover()
    await sleep(HOVER_MS)
    return
  }
  if (step.kind === 'passenger') {
    await selectPassenger(page, step.index)
    await sleep(CLICK_MS)
    return
  }
  if (step.kind === 'seat') {
    await selectSeat(page, step.seat)
    if (step.outcome === 'rejected') {
      const notice = page.getByTestId('seat-notice')
      const text = await notice.textContent({ timeout: 5_000 })
      if (!text?.includes(step.notice)) {
        throw new Error(`seat ${step.seat} was not refused as ${step.reason}: ${text}`)
      }
    } else {
      await page
        .locator(`[data-seat="${step.seat}"][data-state="occupied"]`)
        .waitFor({ timeout: 5_000 })
    }
    await sleep(CLICK_MS)
    return
  }
  throw new Error(`the seat map cannot play a ${step.kind} step`)
}

/** Read one help article, at a reading pace. */
async function readArticle(page, slug) {
  await page.goto('/help')
  await sleep(1_200)
  await page.locator(`a[href="/help/${slug}"]`).first().click()
  await page.waitForURL(`**/help/${slug}`)
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, 420)
    await sleep(900)
  }
}

async function runSession({ session, browser, baseUrl, token, lock, resetBooking }) {
  const startedAt = Date.now()
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: { width: 1440, height: 900 },
    userAgent: USER_AGENT,
  })
  await context.addInitScript(
    ({ token, distinctId, brands }) => {
      // `window.posthog` only exists on a build that exports it, so the distinct id is also
      // written where `posthog-js` reads it on start. Either way the session is this customer's.
      try {
        window.localStorage.setItem(
          `ph_${token}_posthog`,
          JSON.stringify({ distinct_id: distinctId, $device_id: distinctId }),
        )
      } catch {
        // A browser with storage turned off still records; it just starts anonymous.
      }
      try {
        Object.defineProperty(navigator, 'userAgentData', {
          configurable: true,
          get: () => ({
            brands,
            mobile: false,
            platform: 'Windows',
            getHighEntropyValues: async () => ({ brands, mobile: false, platform: 'Windows' }),
          }),
        })
      } catch {
        // Older browsers have no client hints at all, which is what this is imitating.
      }
    },
    { token, distinctId: session.distinctId, brands: BRANDS },
  )

  const page = await context.newPage()
  let confirmed = false

  try {
    await page.goto('/')
    await page.evaluate((id) => globalThis.posthog?.identify?.(id), session.distinctId)
    await sleep(900)

    if (session.shape === 'help-reading') {
      for (const step of session.steps) await readArticle(page, step.slug)
      await sleep(1_500)
    } else {
      // The booking has to be back on its starting seats when the seat map renders, and one
      // booking is shared by every worker, so this part of the journey is taken one at a time.
      await lock(async () => {
        await resetBooking()
        await findReservation(page, LOOKUP_CODE, LOOKUP_LAST_NAME)
        await openSeatsSection(page)
        await openSeatMap(page)
      })

      for (const step of session.steps) {
        if (step.kind === 'confirm') continue
        await playStep(page, step)
      }

      if (session.steps.some((step) => step.kind === 'confirm')) {
        await lock(async () => {
          await confirmSeats(page)
        })
        confirmed = true
      } else {
        // An abandoned session leaves without saving. That is the whole point of it.
        await page.goto('/')
        await sleep(1_200)
      }
    }

    await sleep(SETTLE_MS)
    const sessionId = await readSessionId(context, page, token)
    await page.evaluate(() => globalThis.posthog?.reset?.())
    await sleep(600)

    return {
      index: session.index,
      distinctId: session.distinctId,
      kind: session.kind,
      shape: session.shape,
      sessionId,
      steps: session.interactions,
      confirmed,
      seconds: Math.round((Date.now() - startedAt) / 100) / 10,
    }
  } finally {
    await context.close()
  }
}

function printPlan(sessions) {
  const successful = sessions.filter((session) => session.kind === 'successful')
  console.log(`${sessions.length} sessions: ` + ['successful', 'abandoned', 'unrelated']
    .map((kind) => `${sessions.filter((s) => s.kind === kind).length} ${kind}`)
    .join(', '))
  console.log(
    `median seat-map interactions across the successful sessions: ${median(
      successful.map((session) => session.interactions),
    )}`,
  )
  console.log('')
  console.log('  # | distinct id       | kind       | shape              | ends on     | steps')
  console.log('----+-------------------+------------+--------------------+-------------+------')
  for (const session of sessions) {
    console.log(
      [
        String(session.index).padStart(3),
        session.distinctId.padEnd(17),
        session.kind.padEnd(10),
        session.shape.padEnd(18),
        (session.targetSeats?.join(' ') ?? '-').padEnd(11),
        String(session.interactions).padStart(5),
      ].join(' | '),
    )
  }
}

function printResults(results) {
  console.log('')
  console.log('  # | distinct id       | steps | confirmed | seconds | session id')
  console.log('----+-------------------+-------+-----------+---------+-------------------------------------')
  for (const result of [...results].sort((a, b) => a.index - b.index)) {
    console.log(
      [
        String(result.index).padStart(3),
        result.distinctId.padEnd(17),
        String(result.steps).padStart(5),
        (result.confirmed ? 'yes' : 'no').padEnd(9),
        String(result.seconds).padStart(7),
        result.sessionId ?? '(not read)',
      ].join(' | '),
    )
  }
  const confirmed = results.filter((result) => result.confirmed && result.kind === 'successful')
  console.log('')
  console.log(`sessions played: ${results.length}`)
  console.log(`successful family sessions confirmed: ${confirmed.length}`)
  console.log(
    `median seat-map interactions: ${median(confirmed.map((result) => result.steps))}`,
  )
  console.log(`sessions with no session id read: ${results.filter((r) => !r.sessionId).length}`)
}

const args = parseArgs(process.argv.slice(2))
const baseUrl = (process.env.NOVAAIR_BASE_URL ?? 'http://localhost:4100').replace(/\/$/, '')
const token = process.env.NEXT_PUBLIC_POSTHOG_KEY

const planned = planSessions()

if (args.dryRun) {
  console.log(`dry run. Nothing is sent. Target: ${baseUrl}`)
  console.log(`PostHog project key: ${token ? 'set' : 'NOT SET, so the run would record nothing'}`)
  printPlan(planned)
  process.exit(0)
}

if (!token) {
  console.error(
    'NEXT_PUBLIC_POSTHOG_KEY is not set, so the site would send nothing and the run would be ' +
      'wasted. See .env.example.',
  )
  process.exit(1)
}

const health = await fetch(`${baseUrl}/api/health`).then(
  (response) => response.json(),
  () => null,
)
if (!health?.ok) {
  console.error(`${baseUrl} did not answer /api/health. Start the site first.`)
  process.exit(1)
}
if (!health.analytics) {
  console.error(`${baseUrl} is running without a PostHog key, so it would record nothing.`)
  process.exit(1)
}

const done = args.restart ? new Map() : await readProgress()
const queue = planned.filter(
  (session) => session.index >= args.from && !done.has(session.index),
)
queue.length = Math.min(queue.length, args.limit)

console.log(`site: ${baseUrl} (store: ${health.store})`)
console.log(`already finished: ${done.size}. To play now: ${queue.length}. Workers: ${args.workers}.`)
if (queue.length === 0) {
  console.log('Nothing to do. Use --restart to play the whole run again.')
  process.exit(0)
}

const pool = process.env.SUPABASE_DB_URL ? createPool(process.env.SUPABASE_DB_URL, args.workers) : null
const resetBooking = createReset(baseUrl, pool)
const lock = createMutex()
const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] })

const results = [...done.values()]
const failures = []
let next = 0

async function worker() {
  while (next < queue.length) {
    const session = queue[next]
    next += 1
    if (!session) return
    try {
      const result = await runSession({ session, browser, baseUrl, token, lock, resetBooking })
      results.push(result)
      await appendFile(PROGRESS_FILE, `${JSON.stringify(result)}\n`)
      console.log(
        `[${results.length}/${planned.length}] ${result.distinctId} ${result.shape} ` +
          `${result.confirmed ? 'confirmed' : 'left'} in ${result.seconds}s`,
      )
    } catch (error) {
      failures.push({ index: session.index, distinctId: session.distinctId, message: String(error) })
      console.error(`[fail] ${session.distinctId}: ${error}`)
    }
  }
}

await Promise.all(Array.from({ length: Math.max(1, args.workers) }, () => worker()))
await browser.close()

// Leave the booking as the demo expects to find it.
await resetBooking().catch(() => undefined)
await pool?.end()

printResults(results)

if (failures.length > 0) {
  console.log('')
  console.log(`${failures.length} sessions failed. Run the command again to play just those.`)
  for (const failure of failures) console.log(`  ${failure.index} ${failure.distinctId}: ${failure.message}`)
  process.exit(1)
}
