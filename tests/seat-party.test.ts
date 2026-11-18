import { beforeEach, describe, expect, it } from 'vitest'
import { getRepository } from '../lib/repo'
import * as seatModule from '../lib/seats'
import {
  assignSeatsForParty as applySeatsForParty,
  findSeatsForParty as searchSeatsForParty,
  getAvailableSeats,
  getPassengerRestrictions,
  getReservationByCode,
  getSeatMap,
} from '../lib/seats'
import {
  BLOCKED_SEATS,
  FLIGHT_ID,
  LEFT_COLUMNS,
  RESERVATION_CODE,
  RIGHT_COLUMNS,
  isExitRow,
  parseSeatId,
} from '../lib/seats/constants'
import { DEMO_PASSENGERS } from '../lib/seats/demo-data'
import type { SeatColumn } from '../lib/seats/types'

/**
 * This test is the contract on the seat-party capability. The capability is required and must
 * keep every invariant documented in `AGENTS.md`, under "Adding seat-party capabilities", and in
 * `docs/api.md`.
 */

/** One block of seats offered to a party. */
interface SeatPartyOption {
  row: number
  seatIds: string[]
  extraCostCents: number
}

type AssignSeatsForPartyResult =
  | { ok: true; assignments: { passengerId: string; seatId: string }[] }
  | { ok: false; reason: string; message: string }

const PRIMITIVES = [
  'assignSeat',
  'calculateSeatPrice',
  'getAvailableSeats',
  'getPassengerRestrictions',
  'getReservation',
  'getReservationByCode',
  'getSeatMap',
]

const SEAT_PARTY_EXPORTS = ['findSeatsForParty', 'assignSeatsForParty']

const PARTY = DEMO_PASSENGERS.map((passenger) => passenger.id)
const CHILDREN_ONLY = DEMO_PASSENGERS.filter((passenger) => passenger.type !== 'adult').map(
  (passenger) => passenger.id,
)

/** True when every seat sits in one row, on one side of the aisle, in consecutive columns. */
function isContiguousBlock(seatIds: string[]): boolean {
  const parsed = seatIds.map((id) => parseSeatId(id))
  const seats: { row: number; column: SeatColumn }[] = []
  for (const seat of parsed) {
    if (!seat) return false
    seats.push(seat)
  }
  const first = seats[0]
  if (!first) return false
  if (seats.some((seat) => seat.row !== first.row)) return false

  for (const side of [LEFT_COLUMNS, RIGHT_COLUMNS]) {
    const positions = seats.map((seat) => side.indexOf(seat.column))
    if (positions.some((position) => position < 0)) continue
    const sorted = [...positions].sort((a, b) => a - b)
    const start = sorted[0]
    if (start === undefined) continue
    if (sorted.every((position, offset) => position === start + offset)) return true
  }
  return false
}

function findSeatsForParty(passengerIds: string[]): Promise<SeatPartyOption[]> {
  return searchSeatsForParty(FLIGHT_ID, passengerIds)
}

function assignSeatsForParty(
  passengerIds: string[],
  seatIds: string[],
): Promise<AssignSeatsForPartyResult> {
  return applySeatsForParty(passengerIds, seatIds)
}

async function partySeats(): Promise<Record<string, string | null>> {
  const reservation = await getReservationByCode(RESERVATION_CODE)
  const seats: Record<string, string | null> = {}
  for (const passenger of reservation?.passengers ?? []) seats[passenger.id] = passenger.seatId
  return seats
}

beforeEach(async () => {
  await getRepository().resetDemo()
})

describe('the seat primitives contract', () => {
  it('exports every primitive and the documented seat-party capability', () => {
    const exported = Object.keys(seatModule)
    for (const primitive of PRIMITIVES) expect(exported).toContain(primitive)
    for (const capability of SEAT_PARTY_EXPORTS) expect(exported).toContain(capability)
  })

  it('exports nothing beyond the primitives and the documented seat-party capability', () => {
    const extra = Object.keys(seatModule).filter((name) => !PRIMITIVES.includes(name))
    expect(extra.filter((name) => !SEAT_PARTY_EXPORTS.includes(name))).toEqual([])
  })
})

describe('findSeatsForParty', () => {
  it('offers only contiguous seats in one row, on one side of the aisle', async () => {
    const options = await findSeatsForParty(PARTY)
    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      expect(option.seatIds).toHaveLength(PARTY.length)
      expect(new Set(option.seatIds).size).toBe(option.seatIds.length)
      expect(isContiguousBlock(option.seatIds)).toBe(true)
      expect(parseSeatId(option.seatIds[0] ?? '')?.row).toBe(option.row)
    }
  })

  it('never offers a booked or a blocked seat', async () => {
    const map = await getSeatMap(FLIGHT_ID)
    const cabin = new Map(
      (map?.rows ?? [])
        .flatMap((row) => [...row.left, ...row.right])
        .map((seat) => [seat.id, seat] as const),
    )

    for (const option of await findSeatsForParty(PARTY)) {
      for (const seatId of option.seatIds) {
        const seat = cabin.get(seatId)
        expect(seat, `${seatId} is not a seat on this aircraft`).toBeDefined()
        expect(seat?.baseState, `${seatId} is not free`).toBe('available')
        // A seat the party already holds is fair game. Any other occupant is not.
        if (seat?.occupantPassengerId) expect(PARTY).toContain(seat.occupantPassengerId)
      }
    }
  })

  it('never seats more of the party in an exit row than the party has adults', async () => {
    const restrictions = await Promise.all(PARTY.map((id) => getPassengerRestrictions(id)))
    const adults = restrictions.filter((restriction) => restriction?.canUseExitRow).length

    for (const option of await findSeatsForParty(PARTY)) {
      const inExitRow = option.seatIds.filter((seatId) => {
        const parsed = parseSeatId(seatId)
        return parsed ? isExitRow(parsed.row) : false
      })
      expect(inExitRow.length).toBeLessThanOrEqual(adults)
    }
  })

  it('offers nothing to a party of children, who may not sit without an adult', async () => {
    const restrictions = await Promise.all(CHILDREN_ONLY.map((id) => getPassengerRestrictions(id)))
    expect(restrictions.every((restriction) => restriction?.mustSitWithAdult)).toBe(true)
    expect(await findSeatsForParty(CHILDREN_ONLY)).toEqual([])
  })

  it('prices each block at what its seats cost, and ranks the cheapest first', async () => {
    const options = await findSeatsForParty(PARTY)
    const map = await getSeatMap(FLIGHT_ID)
    const priceById = new Map(
      (map?.rows ?? [])
        .flatMap((row) => [...row.left, ...row.right])
        .map((seat) => [seat.id, seat.priceCents] as const),
    )

    for (const option of options) {
      const total = option.seatIds.reduce((sum, seatId) => sum + (priceById.get(seatId) ?? 0), 0)
      expect(option.extraCostCents).toBe(total)
    }

    const costs = options.map((option) => option.extraCostCents)
    expect(costs).toEqual([...costs].sort((left, right) => left - right))
  })
})

describe('assignSeatsForParty', () => {
  it('moves the whole party in one apply', async () => {
    const [best] = await findSeatsForParty(PARTY)
    expect(best).toBeDefined()
    if (!best) return

    const result = await assignSeatsForParty(PARTY, best.seatIds)
    expect(result.ok).toBe(true)

    const seats = await partySeats()
    expect(Object.values(seats).sort()).toEqual([...best.seatIds].sort())
  })

  it('leaves every passenger where they were when one seat cannot be taken', async () => {
    const before = await partySeats()
    const blocked = BLOCKED_SEATS[0]
    expect(blocked).toBeDefined()
    if (!blocked) return

    // The blocked seat sits second, so an apply that moved passengers one by one would already
    // have moved the first passenger before it failed. Nothing may survive the failure.
    const free = await getAvailableSeats(FLIGHT_ID)
    const seatIds = [free[0], blocked, ...free.slice(1)].slice(0, PARTY.length)
    expect(seatIds.every((seatId) => seatId !== undefined)).toBe(true)

    const result = await assignSeatsForParty(PARTY, seatIds as string[])
    expect(result.ok).toBe(false)
    expect(await partySeats()).toEqual(before)
  })
})
