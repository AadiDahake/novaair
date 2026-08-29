import {
  BLOCKED_SEATS,
  BULKHEAD_PRICE_CENTS,
  COLUMNS,
  EXIT_ROW_PRICE_CENTS,
  LEFT_COLUMNS,
  RIGHT_COLUMNS,
  ROW_COUNT,
  isExitRow,
  isExtraLegroomRow,
  seatId,
} from './constants'
import type { SeatBaseState, SeatColumn, SeatDefinition } from './types'

/**
 * One deterministic function produces the whole availability pattern.
 * Every store - Postgres and in-memory - seeds from this, so the map is identical everywhere.
 *
 * The pattern is not purely random. Random noise sets the background density, then a fixed set of
 * rules shapes the map so the demo has the properties `tests/seed.test.ts` asserts:
 *
 *  1. Row 21 left (21A 21B 21C) is the only no-extra-cost block of three seats together on one
 *     side of the aisle.
 *  2. Rows 9 and 22 offer C and D free across the aisle plus one more seat. A search that ignores
 *     the aisle reads those as three seats together. They are not.
 *  3. Row 2 left and row 16 right are blocks of three, but both cost extra. Row 16 is an exit row,
 *     so children cannot sit there at all.
 *  4. About 60 percent of the cabin is taken.
 */
export const SEAT_MAP_SEED = 214_7726

/** Background chance that any one seat is already taken, before the rules below run. */
const BASE_BOOKED_PROBABILITY = 0.67

/** The one block of three free seats the customer is meant to find. */
const FREE_BLOCK_ROW = 21

/**
 * Rows that look like three seats together only if you ignore the aisle.
 * Each pattern is A B C D E F, where `o` is free and `x` is taken. C and D are free in both, so a
 * search that treats the row as six seats in a line reads three together. They are not together:
 * the aisle sits between C and D.
 */
const AISLE_TRAP_ROWS: ReadonlyArray<readonly [row: number, pattern: string]> = [
  [9, 'xxooox'],
  [22, 'xoooxx'],
]

/** Seats the demo reservation starts on. They must be free for the seed to assign them. */
export const DEMO_START_SEATS = ['12A', '18C', '24F'] as const

/** Seats forced to a fixed state, in the order the rules above describe them. */
const FORCED_SEATS: ReadonlyArray<readonly [string, SeatBaseState]> = [
  // Rule 1: the answer.
  ['21A', 'available'],
  ['21B', 'available'],
  ['21C', 'available'],
  // ... and the other side of row 21 must not also be a block of three.
  ['21E', 'booked'],
  // Rule 2: the aisle traps come from AISLE_TRAP_ROWS, below.
  // Rule 3: blocks of three that cost extra.
  ['2A', 'available'],
  ['2B', 'available'],
  ['2C', 'available'],
  ['16D', 'available'],
  ['16E', 'available'],
  ['16F', 'available'],
  // The demo reservation's own seats.
  ['12A', 'available'],
  ['18C', 'available'],
  ['24F', 'available'],
]

/** Small, fast, deterministic pseudo-random number generator. */
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

export function seatPriceCents(row: number): number {
  if (isExitRow(row)) return EXIT_ROW_PRICE_CENTS
  if (isExtraLegroomRow(row)) return BULKHEAD_PRICE_CENTS
  return 0
}

/**
 * Build every seat on the aircraft, in row then column order.
 * The same seed always produces the same cabin.
 */
export function createSeatDefinitions(seed: number = SEAT_MAP_SEED): SeatDefinition[] {
  const random = mulberry32(seed)
  const states = new Map<string, SeatBaseState>()

  for (let row = 1; row <= ROW_COUNT; row += 1) {
    for (const column of COLUMNS) {
      const state: SeatBaseState = random() < BASE_BOOKED_PROBABILITY ? 'booked' : 'available'
      states.set(seatId(row, column), state)
    }
  }

  for (const [id, state] of FORCED_SEATS) states.set(id, state)
  for (const [row, pattern] of AISLE_TRAP_ROWS) {
    COLUMNS.forEach((column, index) => {
      states.set(seatId(row, column), pattern[index] === 'o' ? 'available' : 'booked')
    })
  }
  for (const id of BLOCKED_SEATS) states.set(id, 'blocked')

  // Rule 1 is a uniqueness claim, so it needs a sweep. In any row that costs nothing, a side of the
  // aisle that is completely free becomes a block of three. Take the middle seat out of every such
  // side except the one the demo needs.
  for (let row = 1; row <= ROW_COUNT; row += 1) {
    if (isExtraLegroomRow(row)) continue
    for (const side of [LEFT_COLUMNS, RIGHT_COLUMNS]) {
      if (row === FREE_BLOCK_ROW && side === LEFT_COLUMNS) continue
      const sideIsFree = side.every((column) => states.get(seatId(row, column)) === 'available')
      if (!sideIsFree) continue
      const middle = side[1] as SeatColumn
      states.set(seatId(row, middle), 'booked')
    }
  }

  const definitions: SeatDefinition[] = []
  for (let row = 1; row <= ROW_COUNT; row += 1) {
    for (const column of COLUMNS) {
      const id = seatId(row, column)
      definitions.push({
        id,
        row,
        column,
        baseState: states.get(id) ?? 'available',
        isExitRow: isExitRow(row),
        isExtraLegroom: isExtraLegroomRow(row),
        priceCents: seatPriceCents(row),
      })
    }
  }
  return definitions
}
