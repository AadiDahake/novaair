/**
 * The plan for the synthetic PostHog sessions.
 *
 * `scripts/seed-posthog-sessions.mjs` drives a real browser over the real site, so this module
 * holds no browser code. It decides what each session does, and it decides it deterministically,
 * so `--dry-run` prints exactly what the real run will play and `tests/synth-sessions.test.ts` can
 * assert the properties the demo depends on.
 *
 * Every seat this plan touches is read out of `createSeatDefinitions`, the one function that
 * defines the cabin. Nothing about the availability pattern is written down twice.
 */
import { BLOCKED_SEATS, COLUMNS, LEFT_COLUMNS, RIGHT_COLUMNS, ROW_COUNT } from '../../lib/seats/constants'
import { DEMO_PASSENGERS } from '../../lib/seats/demo-data'
import { getHelpSlugs } from '../../lib/help/articles'
import { createSeatDefinitions, DEMO_START_SEATS } from '../../lib/seats/seed'
import type { SeatColumn, SeatDefinition } from '../../lib/seats/types'

export const SUCCESSFUL_SESSION_COUNT = 63
export const ABANDONED_SESSION_COUNT = 15
export const UNRELATED_SESSION_COUNT = 5

/**
 * The seat-map interaction count of each successful session, as `seat_assignment_confirmed`
 * reports it: seat clicks, refused clicks and passenger picks.
 *
 * The list is written out rather than generated so the two numbers the demo quotes are visible
 * here and are checked by a test: the median is 14, and the mean is 14.2.
 */
export const INTERACTION_COUNTS: readonly number[] = [
  8, 8, 8, 8,
  9, 9, 9, 9,
  10, 10, 10, 10, 10,
  11, 11, 11, 11, 11,
  12, 12, 12, 12, 12, 12,
  13, 13, 13, 13, 13,
  14, 14, 14, 14, 14, 14,
  15, 15, 15, 15, 15, 15,
  16, 16, 16, 16,
  17, 17, 17, 17,
  18, 18, 18,
  19, 19, 19,
  20, 20, 20,
  21, 21,
  22, 22,
  24,
]

/** The lowest count the site can produce for a party of three: one pick and one seat each. */
const MINIMUM_INTERACTIONS = 6

/** How many of the successful sessions settle for the block of three that costs extra. */
const PAID_OUTCOME_SESSIONS = 9

export type PlanStepKind = 'hover' | 'passenger' | 'seat' | 'confirm' | 'help'

export interface PlanStep {
  kind: PlanStepKind
  /** Seat id, for `hover` and `seat`. */
  seat?: string
  /** Place in the party, for `passenger`. */
  index?: number
  /** Help article slug, for `help`. */
  slug?: string
  /** What the site does with a seat click. */
  outcome?: 'accepted' | 'rejected'
  /** The `seat_selection_rejected` reason a refused click carries. */
  reason?: string
  /** Part of the notice the site shows, so the driver can check it really was refused. */
  notice?: string
}

export type SessionKind = 'successful' | 'abandoned' | 'unrelated'

export interface SynthSession {
  /** Place in the run, counting from one. The resume file keys on it. */
  index: number
  distinctId: string
  kind: SessionKind
  shape: string
  /** The seat of each passenger at the end, in party order. Null when the session never confirms. */
  targetSeats: string[] | null
  /** What `seat_assignment_confirmed` should report as `interactions`. Zero when it never fires. */
  interactions: number
  steps: PlanStep[]
}

/** The same small generator the cabin seed uses, kept local so the domain exports do not move. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

function pick<T>(values: readonly T[], random: () => number): T {
  const value = values[Math.floor(random() * values.length) % values.length]
  if (value === undefined) throw new Error('cannot pick from an empty list')
  return value
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] as number
  return (((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2)
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  return values.reduce((total, value) => total + value, 0) / values.length
}

const SEATS: SeatDefinition[] = createSeatDefinitions()
const SEAT_BY_ID = new Map(SEATS.map((seat) => [seat.id, seat]))
const AVAILABLE = SEATS.filter((seat) => seat.baseState === 'available')
const BOOKED = SEATS.filter((seat) => seat.baseState === 'booked')
const START_SEATS = new Set<string>(DEMO_START_SEATS)

export interface SeatTriple {
  seats: string[]
  priceCentsEach: number
  isExitRow: boolean
}

/**
 * Every block of three free seats that sits on one side of the aisle.
 *
 * This is the search a customer does by eye, and the reason the demo exists: NovaAir has no code
 * that does it. The plan runs it once, here, to know where a hand-worked session can end.
 */
export function contiguousTriples(): SeatTriple[] {
  const triples: SeatTriple[] = []
  for (let row = 1; row <= ROW_COUNT; row += 1) {
    for (const side of [LEFT_COLUMNS, RIGHT_COLUMNS]) {
      const ids = side.map((column: SeatColumn) => `${row}${column}`)
      const seats = ids.map((id) => SEAT_BY_ID.get(id))
      if (seats.some((seat) => seat?.baseState !== 'available')) continue
      const first = seats[0]
      if (!first) continue
      triples.push({ seats: ids, priceCentsEach: first.priceCents, isExitRow: first.isExitRow })
    }
  }
  return triples
}

/**
 * The blocks a party with children can actually use, cheapest first.
 * An exit row is adults only, so a family cannot end there however free it looks.
 */
export const FAMILY_TRIPLES: SeatTriple[] = contiguousTriples()
  .filter((triple) => !triple.isExitRow)
  .sort((a, b) => a.priceCentsEach - b.priceCentsEach)

const RESERVED = new Set<string>([
  ...FAMILY_TRIPLES.flatMap((triple) => triple.seats),
  ...START_SEATS,
  ...BLOCKED_SEATS,
])

/** Seats one passenger can be parked on by mistake. No exit row, so a child can use them too. */
const SPARE_SEATS = AVAILABLE.filter(
  (seat) => !RESERVED.has(seat.id) && !seat.isExitRow,
).map((seat) => seat.id)

/** The seat each passenger moves to in a session that changes one seat and nothing else. */
export const SINGLE_CHANGE_SEATS = DEMO_PASSENGERS.map((_passenger, index) => {
  const seat = SPARE_SEATS[SPARE_SEATS.length - 1 - index]
  if (!seat) throw new Error('the cabin has too few spare seats')
  return seat
})

const SINGLE_CHANGE = new Set(SINGLE_CHANGE_SEATS)

/**
 * Seats that cost extra and are not part of an answer. This is the "paid row" a family tries.
 * An exit row is left out: a click there for a child is refused, not accepted.
 */
const PAID_SEATS = AVAILABLE.filter(
  (seat) =>
    seat.priceCents > 0 && !seat.isExitRow && !RESERVED.has(seat.id) && !SINGLE_CHANGE.has(seat.id),
).map((seat) => seat.id)

/** Free seats a family can park a passenger on while it makes up its mind. */
const FREE_SPARE_SEATS = SPARE_SEATS.filter(
  (id) => !SINGLE_CHANGE.has(id) && SEAT_BY_ID.get(id)?.priceCents === 0,
)

/** Seats another customer already holds. A click on one of these is refused. */
const BOOKED_SEATS = BOOKED.map((seat) => seat.id)

/** Free seats in an exit row. A child cannot sit there, so a click for a child is refused. */
const EXIT_ROW_SEATS = AVAILABLE.filter((seat) => seat.isExitRow).map((seat) => seat.id)

const PARTY = DEMO_PASSENGERS.map((passenger) => ({ index: passenger.index, type: passenger.type }))

const REJECTIONS = {
  seat_booked: 'already taken',
  seat_blocked: 'accessible seating',
  exit_row_child: 'exit row',
  seat_taken_by_party: 'is chosen for',
} as const

function rejectStep(seat: string, reason: keyof typeof REJECTIONS): PlanStep {
  return { kind: 'seat', seat, outcome: 'rejected', reason, notice: REJECTIONS[reason] }
}

function acceptStep(seat: string): PlanStep {
  return { kind: 'seat', seat, outcome: 'accepted' }
}

/**
 * A run of seats to look at, walked outward from a row.
 * This is the scanning a customer does before every choice, and it is what `seat_hovered` records.
 */
function scanSteps(centreRow: number, count: number, random: () => number): PlanStep[] {
  const steps: PlanStep[] = []
  let row = Math.max(1, Math.min(ROW_COUNT, centreRow - Math.floor(count / 3)))
  while (steps.length < count) {
    const column = pick(COLUMNS, random)
    const seat = SEAT_BY_ID.get(`${row}${column}`)
    if (seat) steps.push({ kind: 'hover', seat: seat.id })
    row += 1
    if (row > ROW_COUNT) row = Math.max(1, centreRow - 6)
  }
  return steps
}

/** Split the interactions above the minimum into refused clicks and changes of mind. */
export function splitExtraInteractions(interactions: number): { rejects: number; reconsiders: number } {
  const extra = interactions - MINIMUM_INTERACTIONS
  if (extra < 0) throw new Error(`a party of three cannot confirm in ${interactions} interactions`)
  let reconsiders = Math.min(6, Math.floor(extra / 4))
  let rejects = extra - 2 * reconsiders
  while (rejects > 8 && reconsiders < 6) {
    reconsiders += 1
    rejects -= 2
  }
  return { rejects, reconsiders }
}

function rejectSeatFor(
  passengerIndex: number,
  taken: string[],
  usedBlocked: boolean,
  random: () => number,
): { step: PlanStep; usedBlocked: boolean } {
  const passenger = PARTY[passengerIndex]
  const choices: Array<keyof typeof REJECTIONS> = ['seat_booked', 'seat_booked']
  if (!usedBlocked) choices.push('seat_blocked')
  if (passenger?.type === 'child' && EXIT_ROW_SEATS.length > 0) choices.push('exit_row_child')
  if (taken.length > 0) choices.push('seat_taken_by_party')

  const reason = pick(choices, random)
  if (reason === 'seat_blocked') {
    const seat = BLOCKED_SEATS[0]
    if (!seat) throw new Error('the cabin has no blocked seat')
    return { step: rejectStep(seat, reason), usedBlocked: true }
  }
  if (reason === 'exit_row_child') {
    return { step: rejectStep(pick(EXIT_ROW_SEATS, random), reason), usedBlocked }
  }
  if (reason === 'seat_taken_by_party') {
    return { step: rejectStep(pick(taken, random), reason), usedBlocked }
  }
  return { step: rejectStep(pick(BOOKED_SEATS, random), reason), usedBlocked }
}

const SHAPES = ['family-a', 'family-b', 'family-c'] as const

function buildSuccessful(index: number, interactions: number): SynthSession {
  const random = mulberry32(0x5eed_0000 + index)
  const shape = SHAPES[index % SHAPES.length] as (typeof SHAPES)[number]

  // The cheap block is the one the demo is about. A minority of families give up and pay.
  const paid = index % Math.ceil(SUCCESSFUL_SESSION_COUNT / PAID_OUTCOME_SESSIONS) === 3
  const triple = (paid ? FAMILY_TRIPLES[FAMILY_TRIPLES.length - 1] : FAMILY_TRIPLES[0]) as SeatTriple
  const targetSeats = triple.seats
  const targetRow = Number.parseInt(targetSeats[0] as string, 10)

  const { rejects, reconsiders } = splitExtraInteractions(interactions)
  const scanTotal = shape === 'family-c' ? 15 : shape === 'family-a' ? 11 : 8

  const steps: PlanStep[] = []
  const taken: string[] = []
  let usedBlocked = false
  let rejectsLeft = rejects
  let reconsidersLeft = reconsiders

  for (const passenger of PARTY) {
    const remaining = PARTY.length - passenger.index
    const rejectsHere = Math.ceil(rejectsLeft / remaining)
    const reconsidersHere = Math.ceil(reconsidersLeft / remaining)
    rejectsLeft -= rejectsHere
    reconsidersLeft -= reconsidersHere

    // Family B walks the cabin row by row; the others look around the row they have in mind.
    const centre = shape === 'family-b' ? 9 + passenger.index * 6 : targetRow
    steps.push(...scanSteps(centre, Math.round(scanTotal / PARTY.length), random))

    steps.push({ kind: 'passenger', index: passenger.index })
    for (let i = 0; i < rejectsHere; i += 1) {
      const refusal = rejectSeatFor(passenger.index, taken, usedBlocked, random)
      usedBlocked = refusal.usedBlocked
      steps.push(refusal.step)
    }
    for (let i = 0; i < reconsidersHere; i += 1) {
      // The first change of mind is always a row that costs extra. That is the real hesitation.
      const pool = i === 0 && PAID_SEATS.length > 0 ? PAID_SEATS : FREE_SPARE_SEATS
      steps.push(acceptStep(pick(pool, random)))
      steps.push({ kind: 'passenger', index: passenger.index })
    }
    const seat = targetSeats[passenger.index]
    if (!seat) throw new Error('the answer has fewer seats than the party has passengers')
    steps.push(acceptStep(seat))
    taken.push(seat)
  }

  steps.push({ kind: 'confirm' })

  return {
    index,
    distinctId: `novaair-synth-${String(index).padStart(3, '0')}`,
    kind: 'successful',
    shape,
    targetSeats: [...targetSeats],
    interactions,
    steps,
  }
}

function buildAbandoned(index: number, ordinal: number): SynthSession {
  const random = mulberry32(0xab_0000 + index)
  const steps: PlanStep[] = [...scanSteps(12 + (ordinal % 8), 9 + (ordinal % 5), random)]
  steps.push({ kind: 'passenger', index: 0 })
  steps.push(rejectStep(pick(BOOKED_SEATS, random), 'seat_booked'))
  steps.push(...scanSteps(20, 4, random))
  if (ordinal % 3 === 0) steps.push(acceptStep(pick(FREE_SPARE_SEATS, random)))
  steps.push(...scanSteps(6, 3, random))

  return {
    index,
    distinctId: `novaair-synth-a${String(ordinal).padStart(2, '0')}`,
    kind: 'abandoned',
    shape: 'abandoned',
    targetSeats: null,
    interactions: 0,
    steps,
  }
}

const HELP_SLUGS = getHelpSlugs()

function buildUnrelated(index: number, ordinal: number): SynthSession {
  const random = mulberry32(0x0011_0000 + index)
  if (ordinal <= 3) {
    const first = HELP_SLUGS[(ordinal * 2) % HELP_SLUGS.length]
    const second = HELP_SLUGS[(ordinal * 2 + 1) % HELP_SLUGS.length]
    const steps: PlanStep[] = []
    if (first) steps.push({ kind: 'help', slug: first })
    if (second) steps.push({ kind: 'help', slug: second })
    return {
      index,
      distinctId: `novaair-synth-u${String(ordinal).padStart(2, '0')}`,
      kind: 'unrelated',
      shape: 'help-reading',
      targetSeats: null,
      interactions: 0,
      steps,
    }
  }

  // One passenger wants an aisle seat. Nobody is being seated together, so the miner must say no.
  const passengerIndex = ordinal % PARTY.length
  const seat = SINGLE_CHANGE_SEATS[passengerIndex]
  if (!seat) throw new Error('the cabin has too few spare seats')
  const seats = DEMO_PASSENGERS.map((passenger, i) =>
    i === passengerIndex ? seat : (passenger.seatId as string),
  )
  const steps: PlanStep[] = [
    ...scanSteps(Number.parseInt(seat, 10), 6, random),
    { kind: 'passenger', index: passengerIndex },
    acceptStep(seat),
    { kind: 'confirm' },
  ]
  return {
    index,
    distinctId: `novaair-synth-u${String(ordinal).padStart(2, '0')}`,
    kind: 'unrelated',
    shape: 'single-seat-change',
    targetSeats: seats,
    interactions: 2,
    steps,
  }
}

/** Every session of the run, in the order the run plays them. */
export function planSessions(): SynthSession[] {
  const sessions: SynthSession[] = []
  INTERACTION_COUNTS.forEach((interactions, i) => {
    sessions.push(buildSuccessful(i + 1, interactions))
  })
  for (let ordinal = 1; ordinal <= ABANDONED_SESSION_COUNT; ordinal += 1) {
    sessions.push(buildAbandoned(sessions.length + 1, ordinal))
  }
  for (let ordinal = 1; ordinal <= UNRELATED_SESSION_COUNT; ordinal += 1) {
    sessions.push(buildUnrelated(sessions.length + 1, ordinal))
  }
  return sessions
}

/** What a session should report as `interactions`, counted from its own steps. */
export function plannedInteractions(session: SynthSession): number {
  return session.steps.filter((step) => step.kind === 'seat' || step.kind === 'passenger').length
}
