import { describe, expect, it } from 'vitest'
import {
  BLOCKED_SEATS,
  EXIT_ROWS,
  LEFT_COLUMNS,
  RIGHT_COLUMNS,
  ROW_COUNT,
  isExtraLegroomRow,
  seatId,
} from '../lib/seats/constants'
import { DEMO_START_SEATS, createSeatDefinitions } from '../lib/seats/seed'
import type { SeatDefinition } from '../lib/seats/types'

const seats = createSeatDefinitions()
const byId = new Map(seats.map((seat) => [seat.id, seat]))

function isFree(id: string): boolean {
  return byId.get(id)?.baseState === 'available'
}

/** Every block of three seats together on one side of the aisle. */
function blocksOfThree(): { row: number; ids: string[]; costsExtra: boolean }[] {
  const blocks: { row: number; ids: string[]; costsExtra: boolean }[] = []
  for (let row = 1; row <= ROW_COUNT; row += 1) {
    for (const side of [LEFT_COLUMNS, RIGHT_COLUMNS]) {
      const ids = side.map((column) => seatId(row, column))
      if (ids.every(isFree)) blocks.push({ row, ids, costsExtra: isExtraLegroomRow(row) })
    }
  }
  return blocks
}

describe('the seat map seed', () => {
  it('is the same map every time', () => {
    const again = createSeatDefinitions()
    expect(again.map((seat) => `${seat.id}:${seat.baseState}`)).toEqual(
      seats.map((seat: SeatDefinition) => `${seat.id}:${seat.baseState}`),
    )
  })

  it('builds every seat of a 30 row, 3-3 cabin', () => {
    expect(seats).toHaveLength(ROW_COUNT * 6)
    expect(new Set(seats.map((seat) => seat.id)).size).toBe(ROW_COUNT * 6)
  })

  it('is about 60 percent full', () => {
    const taken = seats.filter((seat) => seat.baseState !== 'available').length
    const percent = (taken / seats.length) * 100
    expect(percent).toBeGreaterThanOrEqual(55)
    expect(percent).toBeLessThanOrEqual(65)
  })

  it('has exactly one block of three free seats that costs nothing extra, and it is row 21 A B C', () => {
    const free = blocksOfThree().filter((block) => !block.costsExtra)
    expect(free).toHaveLength(1)
    expect(free[0]?.ids).toEqual(['21A', '21B', '21C'])
  })

  it('has at least one block of three that only exists in a row that costs extra', () => {
    const paid = blocksOfThree().filter((block) => block.costsExtra)
    expect(paid.length).toBeGreaterThanOrEqual(1)
    for (const block of paid) {
      for (const id of block.ids) expect(byId.get(id)?.priceCents).toBeGreaterThan(0)
    }
  })

  it('has at least two rows where C and D are free across the aisle plus one more seat', () => {
    const trapRows: number[] = []
    for (let row = 1; row <= ROW_COUNT; row += 1) {
      if (isExtraLegroomRow(row)) continue
      if (!isFree(seatId(row, 'C')) || !isFree(seatId(row, 'D'))) continue
      const others = ['A', 'B', 'E', 'F'].filter((column) => isFree(`${row}${column}`))
      if (others.length === 0) continue
      // The trap only works when the row is not already a real block of three.
      const leftIsBlock = LEFT_COLUMNS.every((column) => isFree(seatId(row, column)))
      const rightIsBlock = RIGHT_COLUMNS.every((column) => isFree(seatId(row, column)))
      if (leftIsBlock || rightIsBlock) continue
      trapRows.push(row)
    }
    expect(trapRows.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps the seats the demo booking starts on free for its passengers', () => {
    for (const id of DEMO_START_SEATS) expect(byId.get(id)?.baseState).toBe('available')
  })

  it('blocks seat 20D for accessibility and blocks nothing else', () => {
    const blocked = seats.filter((seat) => seat.baseState === 'blocked').map((seat) => seat.id)
    expect(blocked).toEqual([...BLOCKED_SEATS])
  })

  it('prices the bulkhead and exit rows, and nothing else', () => {
    for (const seat of seats) {
      if (isExtraLegroomRow(seat.row)) expect(seat.priceCents).toBeGreaterThan(0)
      else expect(seat.priceCents).toBe(0)
    }
  })

  it('marks the exit rows', () => {
    const exitRows = new Set(seats.filter((seat) => seat.isExitRow).map((seat) => seat.row))
    expect([...exitRows].sort((a, b) => a - b)).toEqual([...EXIT_ROWS])
  })
})
