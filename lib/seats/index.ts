import { getRepository } from '../repo'
import * as repositoryModule from '../repo'
import { MemorySeatRepository } from '../repo/memory'
import {
  AISLE_AFTER,
  COLUMNS,
  LEFT_COLUMNS,
  RIGHT_COLUMNS,
  UNACCOMPANIED_MINIMUM_AGE,
  parseSeatId,
} from './constants'
import type {
  AssignSeatResult,
  Passenger,
  PassengerRestrictions,
  Reservation,
  Seat,
  SeatMap,
  SeatRow,
  SeatState,
} from './types'

/**
 * The server-side seat primitives and the compositions that search for and assign a party.
 *
 * Each primitive does a single job. Party search and apply compose those primitives while keeping
 * seat availability, passenger restrictions, pricing, and atomic assignment in force.
 * `tests/seat-party.test.ts` holds the party capability to its contract.
 */

const repositoriesWithReset = new WeakSet<ReturnType<typeof getRepository>>()

function getSeatRepository(): ReturnType<typeof getRepository> {
  const repository = getRepository()
  const memory = (globalThis as typeof globalThis & {
    __novaAirAtomicAssignments?: {
      flights: { clear(): void }
      tail: Promise<void>
    }
  }).__novaAirAtomicAssignments

  if (repository instanceof MemorySeatRepository && memory && !repositoriesWithReset.has(repository)) {
    // The memory adapter keeps assignment snapshots separately from the seeded store.
    // Reset both under the same write queue used by single-seat and party assignments.
    const resetDemo = repository.resetDemo.bind(repository)
    repository.resetDemo = async () => {
      const previous = memory.tail
      let release!: () => void
      memory.tail = new Promise<void>((resolve) => {
        release = resolve
      })
      await previous
      try {
        const result = await resetDemo()
        memory.flights.clear()
        return result
      } finally {
        release()
      }
    }
    repositoriesWithReset.add(repository)
  }

  return repository
}

function effectiveState(baseState: Seat['baseState'], occupied: boolean): SeatState {
  if (baseState === 'blocked') return 'blocked'
  if (baseState === 'booked') return 'booked'
  return occupied ? 'occupied' : 'available'
}

/** Read the whole cabin: every row, every seat, and its state right now. */
export async function getSeatMap(flightId: string): Promise<SeatMap | null> {
  const repository = getSeatRepository()
  const flight = await repository.getFlight(flightId)
  if (!flight) return null

  const [definitions, assignments] = await Promise.all([
    repository.getSeatDefinitions(flightId),
    repository.getAssignments(flightId),
  ])
  const occupantBySeat = new Map(assignments.map((entry) => [entry.seatId, entry.passengerId]))

  const rows: SeatRow[] = []
  for (let row = 1; row <= flight.rowCount; row += 1) {
    const inRow = definitions.filter((definition) => definition.row === row)
    if (inRow.length === 0) continue

    const seats: Seat[] = inRow.map((definition) => {
      const occupantPassengerId = occupantBySeat.get(definition.id) ?? null
      return {
        ...definition,
        occupantPassengerId,
        state: effectiveState(definition.baseState, occupantPassengerId !== null),
      }
    })
    const first = inRow[0]
    rows.push({
      row,
      isExitRow: first?.isExitRow ?? false,
      isExtraLegroom: first?.isExtraLegroom ?? false,
      left: LEFT_COLUMNS.map((column) => seats.find((seat) => seat.column === column)).filter(
        (seat): seat is Seat => seat !== undefined,
      ),
      right: RIGHT_COLUMNS.map((column) => seats.find((seat) => seat.column === column)).filter(
        (seat): seat is Seat => seat !== undefined,
      ),
    })
  }

  return {
    flightId: flight.id,
    cabinName: flight.cabinName,
    rowCount: flight.rowCount,
    columns: COLUMNS,
    aisleAfter: AISLE_AFTER,
    rows,
  }
}

/** The ids of every seat a passenger could take right now, in row then column order. */
export async function getAvailableSeats(flightId: string): Promise<string[]> {
  const map = await getSeatMap(flightId)
  if (!map) return []
  const available: string[] = []
  for (const row of map.rows) {
    for (const seat of [...row.left, ...row.right]) {
      if (seat.state === 'available') available.push(seat.id)
    }
  }
  return available
}

/** What one passenger is and is not allowed to do. */
export async function getPassengerRestrictions(
  passengerId: string,
): Promise<PassengerRestrictions | null> {
  const passenger = await getSeatRepository().getPassenger(passengerId)
  if (!passenger) return null
  return {
    passengerId: passenger.id,
    type: passenger.type,
    age: passenger.age,
    canUseExitRow: passenger.type === 'adult',
    mustSitWithAdult: passenger.age < UNACCOMPANIED_MINIMUM_AGE,
  }
}

/** What one seat costs, in cents. Zero for a standard seat. */
export async function calculateSeatPrice(flightId: string, seatId: string): Promise<number | null> {
  const parsed = parseSeatId(seatId)
  if (!parsed) return null
  const definition = await getSeatRepository().getSeatDefinition(flightId, seatId.trim().toUpperCase())
  return definition?.priceCents ?? null
}

/**
 * Move one passenger to one seat.
 *
 * Atomic: the store rejects a seat another passenger already holds.
 * Idempotent: calling it again with the same passenger and seat succeeds and changes nothing.
 * It moves one passenger. There is no bulk form of this call.
 */
export async function assignSeat(passengerId: string, seatId: string): Promise<AssignSeatResult> {
  return assignSeatWithRepository(getSeatRepository(), passengerId, seatId)
}

async function assignSeatWithRepository(
  repository: ReturnType<typeof getRepository>,
  passengerId: string,
  seatId: string,
): Promise<AssignSeatResult> {
  const normalizedSeatId = seatId.trim().toUpperCase()

  const passenger = await repository.getPassenger(passengerId)
  if (!passenger) {
    return { ok: false, reason: 'passenger_not_found', message: 'We cannot find that passenger.' }
  }

  const reservation = await repository.getReservationByCode(passenger.reservationCode)
  if (!reservation) {
    return { ok: false, reason: 'passenger_not_found', message: 'We cannot find that passenger.' }
  }

  const seat = await repository.getSeatDefinition(reservation.flightId, normalizedSeatId)
  if (!seat) {
    return { ok: false, reason: 'seat_not_found', message: `Seat ${normalizedSeatId} is not on this aircraft.` }
  }

  if (seat.baseState === 'blocked') {
    return {
      ok: false,
      reason: 'seat_blocked',
      message: `Seat ${seat.id} is held for a customer who needs accessible seating. Please pick another seat.`,
    }
  }
  if (seat.baseState === 'booked') {
    return {
      ok: false,
      reason: 'seat_booked',
      message: `Seat ${seat.id} is already taken. Please pick another seat.`,
    }
  }
  if (seat.isExitRow && passenger.type !== 'adult') {
    return {
      ok: false,
      reason: 'exit_row_child',
      message: `Seat ${seat.id} is in an exit row. Exit rows are for adults only, so ${passenger.firstName} cannot sit there.`,
    }
  }

  const result = await repository.assign(reservation.flightId, passenger.id, seat.id)
  if (!result.ok) {
    return {
      ok: false,
      reason: 'seat_booked',
      message: `Seat ${seat.id} was taken while you were choosing. Please pick another seat.`,
    }
  }

  return {
    ok: true,
    passengerId: passenger.id,
    seatId: seat.id,
    previousSeatId: result.previousSeatId,
    priceCents: seat.priceCents,
  }
}

/** Find one reservation by its confirmation code and the last name on it. */
export async function getReservation(code: string, lastName: string): Promise<Reservation | null> {
  const repository = getSeatRepository()
  const record = await repository.findReservation(code, lastName)
  if (!record) return null

  const [flight, passengers] = await Promise.all([
    repository.getFlight(record.flightId),
    repository.getPassengers(record.code),
  ])
  if (!flight) return null

  return {
    code: record.code,
    lastName: record.lastName,
    flight,
    passengers,
    bookedOn: record.bookedOn,
    fareBrand: record.fareBrand,
    totalPaidUsd: record.totalPaidUsd,
  }
}

/** Read a reservation when the code is already trusted, for example from the URL of a trip page. */
export async function getReservationByCode(code: string): Promise<Reservation | null> {
  const record = await getSeatRepository().getReservationByCode(code)
  if (!record) return null
  return getReservation(record.code, record.lastName)
}

interface PartyAssignment {
  passengerId: string
  seatId: string
}

interface PartyBlock {
  row: number
  seatIds: string[]
  seats: string[]
  assignments: PartyAssignment[]
  extraCostCents: number
  totalPriceCents: number
  totalCostCents: number
  priceCents: number
}

interface PartyAssignmentSnapshot {
  passengerId: string
  seatId: string | null
}

type PartyApplyResult =
  | { ok: true; assignments: PartyAssignment[]; totalPriceCents: number }
  | { ok: false; reason: string; message: string }

async function partyRestrictions(
  flightId: string,
  passengerIds: string[],
): Promise<PassengerRestrictions[] | null> {
  if (passengerIds.length === 0 || passengerIds.length > 3) return null
  if (new Set(passengerIds).size !== passengerIds.length) return null

  const repository = getSeatRepository()
  const passengers = await Promise.all(passengerIds.map((id) => repository.getPassenger(id)))
  if (passengers.some((passenger) => !passenger)) return null
  const first = passengers[0]
  if (!first || passengers.some((passenger) => passenger?.reservationCode !== first.reservationCode)) {
    return null
  }

  const reservation = await getReservationByCode(first.reservationCode)
  if (!reservation || reservation.flight.id !== flightId) return null
  if (passengerIds.some((id) => !reservation.passengers.some ( (passenger) => passenger.id === id))) {
    return null
  }

  const restrictions = await Promise.all(passengerIds.map((id) => getPassengerRestrictions(id)))
  if (restrictions.some((restriction) => !restriction)) return null
  return restrictions.filter((restriction): restriction is PassengerRestrictions => restriction !== null)
}

function arrangeParty(
  seats: Seat[],
  restrictions: PassengerRestrictions[],
): PartyAssignment[] | null {
  const used = new Set<string>()
  const ordered: PassengerRestrictions[] = []

  function arrange(index: number): boolean {
    if (index === seats.length) {
      return ordered.every((restriction, position) => {
        if (!restriction.mustSitWithAdult) return true
        return (
          (position > 0 && ordered[position - 1]?.type === 'adult') ||
          (position + 1 < ordered.length && ordered[position + 1]?.type === 'adult')
        )
      })
    }

    for (const restriction of restrictions) {
      if (used.has(restriction.passengerId)) continue
      if (seats[index]?.isExitRow && !restriction.canUseExitRow) continue
      used.add(restriction.passengerId)
      ordered.push(restriction)
      if (arrange(index + 1)) return true
      ordered.pop()
      used.delete(restriction.passengerId)
    }
    return false
  }

  if (!arrange(0)) return null
  return ordered.map((restriction, index) => ({
    passengerId: restriction.passengerId,
    seatId: seats[index]!.id,
  }))
}

/** Find same-side, contiguous blocks, ordered by their combined seat fee. */
export async function findSeatsForParty(
  flightId: string,
  passengerIds: string[],
): Promise<PartyBlock[]> {
  const restrictions = await partyRestrictions(flightId, passengerIds)
  if (!restrictions) return []

  const [map, availableSeats] = await Promise.all([
    getSeatMap(flightId),
    getAvailableSeats(flightId),
  ])
  if (!map) return []

  const available = new Set(availableSeats)
  const party = new Set(passengerIds)
  const blocks: PartyBlock[] = []

  for (const row of map.rows) {
    for (const side of [row.left, row.right]) {
      for (let start = 0; start + passengerIds.length <= side.length; start += 1) {
        const seats = side.slice(start, start + passengerIds.length)
        const columns = side === row.left ? LEFT_COLUMNS : RIGHT_COLUMNS
        if (seats.some((seat, index) => seat.column !== columns[start + index])) continue
        if (
          seats.some(
            (seat) =>
              seat.baseState !== 'available' ||
              (seat.occupantPassengerId
                ? !party.has(seat.occupantPassengerId)
                : !available.has(seat.id)),
          )
        ) {
          continue
        }

        const assignments = arrangeParty(seats, restrictions)
        if (!assignments) continue
        const prices = await Promise.all(seats.map((seat) => calculateSeatPrice(flightId, seat.id)))
        if (prices.some((price) => price === null)) continue
        const totalPriceCents = prices.reduce<number>((sum, price) => sum + (price ?? 0), 0)
        const seatIds = seats.map((seat) => seat.id)
        blocks.push({
          row: row.row,
          seatIds,
          seats: seatIds,
          assignments,
          extraCostCents: totalPriceCents,
          totalPriceCents,
          totalCostCents: totalPriceCents,
          priceCents: totalPriceCents,
        })
      }
    }
  }

  return blocks.sort((a, b) => a.totalPriceCents - b.totalPriceCents)
}

/**
 * Revalidate and stage the whole party before publishing a single conflict-checked snapshot.
 * If the repository has no atomic batch boundary, fail without writing any assignments.
 */
export function assignSeatsForParty(
  passengerIds: string[],
  seatIds: string[],
): Promise<PartyApplyResult>
export function assignSeatsForParty(
  flightId: string,
  passengerIds: string[],
  seatIds: string[],
): Promise<PartyApplyResult>
export async function assignSeatsForParty(
  flightIdOrPassengerIds: string | string[],
  passengerIdsOrSeatIds: string[],
  flightSeatIds?: string[],
): Promise<PartyApplyResult> {
  const conflict: PartyApplyResult = {
    ok: false,
    reason: 'seat_booked',
    message: 'These seats are no longer available. Please search for seats together again.',
  }
  const passengerIds =
    typeof flightIdOrPassengerIds === 'string' ? passengerIdsOrSeatIds : flightIdOrPassengerIds
  const seatIds =
    typeof flightIdOrPassengerIds === 'string' ? flightSeatIds : passengerIdsOrSeatIds
  if (!seatIds || seatIds.length !== passengerIds.length || passengerIds.length === 0) return conflict

  const repository = getSeatRepository()
  let flightId: string
  if (typeof flightIdOrPassengerIds === 'string') {
    flightId = flightIdOrPassengerIds
  } else {
    const firstPassengerId = passengerIds[0]
    if (!firstPassengerId) return conflict
    const passenger = await repository.getPassenger(firstPassengerId)
    if (!passenger) return conflict
    const reservation = await getReservationByCode(passenger.reservationCode)
    if (!reservation) return conflict
    flightId = reservation.flight.id
  }

  const normalized = seatIds.map((seatId) => seatId.trim().toUpperCase())
  const current = await repository.getAssignments(flightId)
  const blocks = await findSeatsForParty(flightId, passengerIds)
  const block = blocks.find(
    (candidate) => candidate.seatIds.every((seatId, index) => seatId === normalized[index]),
  )
  if (!block) return conflict

  const party = new Set(passengerIds)
  const expectedAssignments: PartyAssignmentSnapshot[] = passengerIds.map((passengerId) => ({
    passengerId,
    seatId: current.find((entry) => entry.passengerId === passengerId)?.seatId ?? null,
  }))
  const occupied = new Map(
    current
      .filter((entry) => !party.has(entry.passengerId))
      .map((entry) => [entry.seatId, entry.passengerId]),
  )
  const stagedRepository = new Proxy(repository, {
    get(target, property) {
      if (property === 'assign') {
        return async (_flightId: string, passengerId: string, seatId: string) => {
          if (occupied.has(seatId)) return { ok: false }
          occupied.set(seatId, passengerId)
          return {
            ok: true,
            previousSeatId: expectedAssignments.find((entry) => entry.passengerId === passengerId)?.seatId ?? null,
          }
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  for (const assignment of block.assignments) {
    const result = await assignSeatWithRepository(stagedRepository, assignment.passengerId, assignment.seatId)
    if (!result.ok) return result
  }

  const boundary = repositoryModule as unknown as {
    commitSeatAssignments?: (
      flightId: string,
      assignments: PartyAssignment[],
      expectedAssignments: PartyAssignmentSnapshot[],
    ) => Promise<boolean | { ok: boolean }>
  }
  if (!boundary.commitSeatAssignments) return conflict

  try {
    const result = await boundary.commitSeatAssignments(
      flightId,
      block.assignments,
      expectedAssignments,
    )
    if (typeof result === 'boolean' ? !result : !result.ok) return conflict
  } catch {
    return conflict
  }

  return { ok: true, assignments: block.assignments, totalPriceCents: block.totalPriceCents }
}

export type { Passenger, Reservation, Seat, SeatMap, SeatRow }
