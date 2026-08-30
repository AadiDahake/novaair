#!/usr/bin/env node
/**
 * Seed the "thirty days after the change" numbers.
 *
 * These are the only numbers in the demo that no real system can produce, because the change has
 * not shipped and the thirty days have not passed. So they are seeded, and every event says so:
 * `seeded: true` and a `source` naming this file. `docs/analytics.md` writes down what they mean
 * and that the site never sends them.
 *
 * They go through PostHog's public capture endpoint rather than a browser. Nobody watches 1,428
 * replays, so there is no reason to spend an hour of browser time making them. The 63 evidence
 * sessions are the opposite case and are recorded for real by `seed-posthog-sessions.mjs`.
 *
 *   node --import tsx scripts/seed-posthog-outcomes.mjs [--dry-run] [--again]
 *
 * PostHog cannot delete event data, so this refuses to run twice unless you ask it to.
 */
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { captureBatch, readCaptureEnv } from './lib/posthog.mjs'
import { loadEnv } from './lib/env.mjs'

loadEnv()

const MARKER_FILE = '.posthog-outcomes-seeded.json'
const BATCH_SIZE = 500
const DAY_MS = 24 * 60 * 60 * 1000

/** The figures the plan fixes. Every count below is derived from these. */
const OUTCOME = {
  eligibleTravelers: 1_428,
  usedTheFeature: 917,
  succeeded: 884,
  /** The mean seat-map interactions after the change. Before it, PostHog measures 14.2. */
  meanInteractionsAfter: 2.1,
  /** Seat-related support contacts, in the thirty days before and the thirty days after. */
  supportBefore: 251,
  supportAfter: 148,
}

/** The window each half of the support comparison falls in, in days before now. */
const AFTER_WINDOW = [0, 30]
const BEFORE_WINDOW = [30, 60]

const COMMON = {
  seeded: true,
  source: 'scripts/seed-posthog-outcomes.mjs',
  capability: 'seat_party_together',
  note: 'seeded outcome data. NovaAir does not send these events.',
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * The interactions each successful use of the feature took.
 *
 * Two clicks is the feature working: choose the party, accept the seats it found. Some travelers
 * look first, and a few change their minds. The mean of the list is the figure the plan quotes.
 */
function interactionsAfter(count, target) {
  const wanted = Math.round(count * target)
  const values = Array.from({ length: count }, () => 2)
  // Lift a few to three and four, and drop a few to one, until the total is exactly right.
  let index = 0
  const bump = (by, howMany) => {
    for (let i = 0; i < howMany; i += 1) {
      values[index % count] += by
      index += 7
    }
  }
  bump(-1, 90)
  bump(1, 142)
  bump(2, 18)
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total !== wanted) {
    throw new Error(`the interaction list totals ${total}, not ${wanted}`)
  }
  return values
}

/** A timestamp somewhere inside a window measured in days before now, as ISO 8601. */
function timestampIn([fromDays, toDays], random, now) {
  const span = (toDays - fromDays) * DAY_MS
  const at = now - fromDays * DAY_MS - random() * span
  return new Date(at).toISOString()
}

function buildEvents(now = Date.now()) {
  const random = mulberry32(0x0c_a5_e5)
  const events = []

  const interactions = interactionsAfter(OUTCOME.succeeded, OUTCOME.meanInteractionsAfter)

  for (let traveler = 1; traveler <= OUTCOME.eligibleTravelers; traveler += 1) {
    const distinctId = `novaair-outcome-${String(traveler).padStart(4, '0')}`
    const partySize = 2 + Math.floor(random() * 4)
    const eligibleAt = new Date(timestampIn(AFTER_WINDOW, random, now))
    const properties = { ...COMMON, distinct_id: distinctId, party_size: partySize }

    events.push({
      event: 'seat_party_together_eligible',
      properties,
      timestamp: eligibleAt.toISOString(),
    })

    // The travelers who used it, then the ones it worked for, are prefixes of the same list, so
    // the funnel PostHog computes from these events is a real funnel.
    if (traveler > OUTCOME.usedTheFeature) continue
    const usedAt = new Date(eligibleAt.getTime() + (20 + random() * 100) * 1_000)
    events.push({
      event: 'seat_party_together_used',
      properties,
      timestamp: usedAt.toISOString(),
    })

    if (traveler > OUTCOME.succeeded) continue
    const succeededAt = new Date(usedAt.getTime() + (10 + random() * 80) * 1_000)
    events.push({
      event: 'seat_party_together_succeeded',
      properties: {
        ...properties,
        interactions: interactions[traveler - 1],
        same_row: true,
        contiguous: true,
      },
      timestamp: succeededAt.toISOString(),
    })
  }

  const support = [
    ['before_launch', OUTCOME.supportBefore, BEFORE_WINDOW],
    ['after_launch', OUTCOME.supportAfter, AFTER_WINDOW],
  ]
  for (const [period, count, window] of support) {
    for (let contact = 1; contact <= count; contact += 1) {
      events.push({
        event: 'seat_support_contact',
        properties: {
          ...COMMON,
          distinct_id: `novaair-support-${period === 'before_launch' ? 'b' : 'a'}${String(contact).padStart(4, '0')}`,
          period,
          topic: 'seating',
        },
        timestamp: timestampIn(window, random, now),
      })
    }
  }

  return events
}

function summarise(events) {
  const count = (name) => events.filter((event) => event.event === name).length
  const succeeded = events.filter((event) => event.event === 'seat_party_together_succeeded')
  const meanInteractions =
    succeeded.reduce((sum, event) => sum + event.properties.interactions, 0) / succeeded.length
  const support = (period) =>
    events.filter(
      (event) => event.event === 'seat_support_contact' && event.properties.period === period,
    ).length
  const before = support('before_launch')
  const after = support('after_launch')
  const timestamps = events.map((event) => Date.parse(event.timestamp)).sort((a, b) => a - b)
  return {
    total: events.length,
    eligible: count('seat_party_together_eligible'),
    used: count('seat_party_together_used'),
    succeeded: succeeded.length,
    meanInteractions: Number(meanInteractions.toFixed(2)),
    supportBefore: before,
    supportAfter: after,
    supportChangePercent: Math.round(((after - before) / before) * 100),
    earliest: new Date(timestamps[0]).toISOString(),
    latest: new Date(timestamps[timestamps.length - 1]).toISOString(),
  }
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const again = args.includes('--again')
for (const arg of args) {
  if (arg !== '--dry-run' && arg !== '--again') {
    console.error(`unknown option: ${arg}`)
    process.exit(2)
  }
}

const events = buildEvents()
const summary = summarise(events)

console.log('Seeded outcome data for seat_party_together, thirty days after the change.')
console.log(`  events to send                 ${summary.total}`)
console.log(`  eligible travelers             ${summary.eligible}`)
console.log(`  used the feature               ${summary.used}`)
console.log(`  succeeded                      ${summary.succeeded}`)
console.log(`  mean interactions after        ${summary.meanInteractions}`)
console.log(`  support contacts               ${summary.supportBefore} -> ${summary.supportAfter} (${summary.supportChangePercent}%)`)
console.log(`  timestamps                     ${summary.earliest} to ${summary.latest}`)
console.log('  every event carries seeded: true')

if (dryRun) {
  console.log('')
  console.log('Dry run. Nothing was sent. One sample of each event:')
  const seen = new Set()
  for (const event of events) {
    if (seen.has(event.event)) continue
    seen.add(event.event)
    console.log(`  ${JSON.stringify(event)}`)
  }
  process.exit(0)
}

const capture = readCaptureEnv()
if (capture.missing.length > 0) {
  console.error(`not set: ${capture.missing.join(', ')}. See .env.example.`)
  process.exit(1)
}

const marker = await readFile(MARKER_FILE, 'utf8').catch(() => null)
if (marker && !again) {
  console.error('')
  console.error(`These events were already sent (${MARKER_FILE}). PostHog cannot delete event data,`)
  console.error('so a second run would double every number. Pass --again if that is what you want.')
  process.exit(1)
}

console.log('')
let sent = 0
for (let i = 0; i < events.length; i += BATCH_SIZE) {
  const batch = events.slice(i, i + BATCH_SIZE)
  // `historical_migration` stays false: PostHog gates it behind a paid plan and requires every
  // timestamp to be at least 48 hours old, which the most recent of these are not.
  await captureBatch(capture, batch, { historicalMigration: false })
  sent += batch.length
  console.log(`sent ${sent}/${events.length}`)
}

await writeFile(MARKER_FILE, `${JSON.stringify({ sentAt: new Date().toISOString(), ...summary }, null, 2)}\n`)
console.log('')
console.log('Done. Run `npm run seed:verify` to read the numbers back out of PostHog.')
