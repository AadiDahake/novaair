import { getRepository } from '../repo'
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
 * The server-side seat primitives and the seat-party capability composed from them.
 *
 * Each primitive does a single job. `findSeatsForParty` and `assignSeatsForParty` deliberately
 * compose those primitives to find ranked blocks and move a whole party together.
 *
 * `AGENTS.md`, under "Adding seat-party capabilities", says what the capability must keep true,
 * and `tests/seat-party.test.ts` enforces it.
 */

export interface SeatPartyOption {
  row: number
  seatIds: string[]
  extraCostCents: number
}

export type AssignSeatsForPartyResult =
  | {
      ok: true
      assignments: { passengerId: string; seatId: string }[]
    }
  | {
      ok: false
      reason: string
      message: string
    }

function effectiveState(baseState: Seat['baseState'], occupied: boolean): SeatState {
  if (baseState === 'blocked') return 'blocked'
  if (baseState === 'booked') return 'booked'
  return occupied ? 'occupied' : 'available'
}

/** Read the whole cabin: every row, every seat, and its state right now. */
export async function getSeatMap(flightId: string): Promise<SeatMap | null> {
  const repository = getRepository()
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
  const passenger = await getRepository().getPassenger(passengerId)
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
  const definition = await getRepository().getSeatDefinition(flightId, seatId.trim().toUpperCase())
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
  const repository = getRepository()
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
    return {
      ok: false,
      reason: 'seat_not_found',
      message: `Seat ${normalizedSeatId} is not on this aircraft.`,
    }
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
  const repository = getRepository()
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
  const record = await getRepository().getReservationByCode(code)
  if (!record) return null
  return getReservation(record.code, record.lastName)
}

/** Find valid same-row blocks for a party, ranked by total extra cost. */
export async function findSeatsForParty(
  flightId: string,
  passengerIds: string[],
): Promise<SeatPartyOption[]> {
  if (passengerIds.length === 0 || new Set(passengerIds).size !== passengerIds.length) return []

  const repository = getRepository()
  const [map, availableSeatIds, restrictions, passengerRecords] = await Promise.all([
    getSeatMap(flightId),
    getAvailableSeats(flightId),
    Promise.all(passengerIds.map((passengerId) => getPassengerRestrictions(passengerId))),
    Promise.all(passengerIds.map((passengerId) => repository.getPassenger(passengerId))),
  ])

  if (!map || restrictions.some((restriction) => restriction === null)) return []
  if (passengerRecords.some((passenger) => passenger === null)) return []

  const reservationCodes = new Set(
    passengerRecords.map((passenger) => passenger?.reservationCode).filter(Boolean),
  )
  if (reservationCodes.size !== 1) return []

  const reservationCode = reservationCodes.values().next().value
  if (typeof reservationCode !== 'string') return []

  const reservation = await repository.getReservationByCode(reservationCode)
  if (!reservation || reservation.flightId !== flightId) return []

  const validRestrictions = restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  const hasAdult = validRestrictions.some((restriction) => restriction.type === 'adult')
  if (
    validRestrictions.some((restriction) => restriction.mustSitWithAdult) &&
    !hasAdult
  ) {
    return []
  }

  const party = new Set(passengerIds)
  const available = new Set(availableSeatIds)
  const options: SeatPartyOption[] = []

  for (const row of map.rows) {
    for (const side of [row.left, row.right]) {
      if (side.length < passengerIds.length) continue

      for (let start = 0; start <= side.length - passengerIds.length; start += 1) {
        const seats = side.slice(start, start + passengerIds.length)
        if (seats.length !== passengerIds.length) continue

        const first = seats[0]
        if (!first) continue

        const contiguous = seats.every(
          (seat, index) => side.indexOf(seat) === side.indexOf(first) + index,
        )
        if (!contiguous) continue

        const freeForParty = seats.every(
          (seat) =>
            seat.baseState === 'available' &&
            (available.has(seat.id) ||
              (seat.occupantPassengerId !== null && party.has(seat.occupantPassengerId))),
        )
        if (!freeForParty) continue

        if (
          seats.some((seat) => seat.isExitRow) &&
          validRestrictions.some((restriction) => !restriction.canUseExitRow)
        ) {
          continue
        }

        const prices = await Promise.all(
          seats.map((seat) => calculateSeatPrice(flightId, seat.id)),
        )
        if (prices.some((price) => price === null)) continue

        options.push({
          row: row.row,
          seatIds: seats.map((seat) => seat.id),
          extraCostCents: prices.reduce<number>(
            (total, price) => total + (price ?? 0),
            0,
          ),
        })
      }
    }
  }

  return options.sort(
    (left, right) =>
      left.extraCostCents - right.extraCostCents ||
      left.row - right.row ||
      left.seatIds.join(',').localeCompare(right.seatIds.join(',')),
  )
}

/**
 * Move a party into one recommended block.
 *
 * Every target is validated before the first move. Moves are dependency ordered so a passenger
 * vacates a party-held seat before another passenger takes it. If a write fails, completed moves
 * are restored in reverse order.
 */
export async function assignSeatsForParty(
  passengerIds: string[],
  seatIds: string[],
): Promise<AssignSeatsForPartyResult> {
  if (
    passengerIds.length === 0 ||
    passengerIds.length !== seatIds.length ||
    new Set(passengerIds).size !== passengerIds.length
  ) {
    return {
      ok: false,
      reason: 'invalid_party',
      message: 'Choose one seat for each passenger in the party.',
    }
  }

  const normalizedSeatIds = seatIds.map((seatId) => seatId.trim().toUpperCase())
  if (
    normalizedSeatIds.some((seatId) => !parseSeatId(seatId)) ||
    new Set(normalizedSeatIds).size !== normalizedSeatIds.length
  ) {
    return {
      ok: false,
      reason: 'invalid_seats',
      message: 'Choose a different block of seats and try again.',
    }
  }

  const repository = getRepository()
  const passengerRecords = await Promise.all(
    passengerIds.map((passengerId) => repository.getPassenger(passengerId)),
  )
  if (passengerRecords.some((passenger) => passenger === null)) {
    return {
      ok: false,
      reason: 'passenger_not_found',
      message: 'We cannot find every passenger in that party.',
    }
  }

  const reservationCodes = new Set(
    passengerRecords.map((passenger) => passenger?.reservationCode).filter(Boolean),
  )
  if (reservationCodes.size !== 1) {
    return {
      ok: false,
      reason: 'invalid_party',
      message: 'All passengers must be on the same booking.',
    }
  }

  const reservationCode = reservationCodes.values().next().value
  if (typeof reservationCode !== 'string') {
    return {
      ok: false,
      reason: 'passenger_not_found',
      message: 'We cannot find every passenger in that party.',
    }
  }

  const reservation = await getReservationByCode(reservationCode)
  if (!reservation) {
    return {
      ok: false,
      reason: 'passenger_not_found',
      message: 'We cannot find every passenger in that party.',
    }
  }

  const reservationPassengerIds = new Set(
    reservation.passengers.map((passenger) => passenger.id),
  )
  if (passengerIds.some((passengerId) => !reservationPassengerIds.has(passengerId))) {
    return {
      ok: false,
      reason: 'invalid_party',
      message: 'All passengers must be on the same booking.',
    }
  }

  const options = await findSeatsForParty(reservation.flight.id, passengerIds)
  const requestedSeats = [...normalizedSeatIds].sort()
  const option = options.find(
    (candidate) =>
      [...candidate.seatIds].sort().every((seatId, index) => seatId === requestedSeats[index]),
  )
  if (!option) {
    return {
      ok: false,
      reason: 'seats_unavailable',
      message: 'Those seats are no longer available together. Find another block and try again.',
    }
  }

  const currentSeatByPassenger = new Map(
    reservation.passengers.map((passenger) => [passenger.id, passenger.seatId]),
  )
  if (passengerIds.some((passengerId) => !currentSeatByPassenger.get(passengerId))) {
    return {
      ok: false,
      reason: 'atomic_assignment_unavailable',
      message: 'We could not move the whole party together. Your current seats have not changed.',
    }
  }

  const occupancy = new Map<string, string>()
  for (const passenger of reservation.passengers) {
    if (passenger.seatId) occupancy.set(passenger.seatId, passenger.id)
  }

  const remaining = passengerIds.map((passengerId, index) => ({
    passengerId,
    seatId: normalizedSeatIds[index] as string,
  }))
  const ordered: { passengerId: string; seatId: string }[] = []

  while (remaining.length > 0) {
    const index = remaining.findIndex(({ passengerId, seatId }) => {
      const holder = occupancy.get(seatId)
      return !holder || holder === passengerId
    })
    if (index === -1) {
      return {
        ok: false,
        reason: 'assignment_cycle',
        message: 'We could not move the whole party together. Your current seats have not changed.',
      }
    }

    const [assignment] = remaining.splice(index, 1)
    if (!assignment) break

    const previousSeatId = currentSeatByPassenger.get(assignment.passengerId)
    if (previousSeatId) occupancy.delete(previousSeatId)
    occupancy.set(assignment.seatId, assignment.passengerId)
    ordered.push(assignment)
  }

  const completed: {
    passengerId: string
    seatId: string
    previousSeatId: string
  }[] = []

  for (const assignment of ordered) {
    const result = await assignSeat(assignment.passengerId, assignment.seatId)
    if (!result.ok) {
      for (const previous of [...completed].reverse()) {
        await assignSeat(previous.passengerId, previous.previousSeatId)
      }
      return {
        ok: false,
        reason: result.reason,
        message: result.message,
      }
    }

    const previousSeatId = result.previousSeatId
    if (!previousSeatId) {
      for (const previous of [...completed].reverse()) {
        await assignSeat(previous.passengerId, previous.previousSeatId)
      }
      return {
        ok: false,
        reason: 'atomic_assignment_unavailable',
        message: 'We could not move the whole party together. Your current seats have not changed.',
      }
    }

    completed.push({
      passengerId: result.passengerId,
      seatId: result.seatId,
      previousSeatId,
    })
  }

  return {
    ok: true,
    assignments: passengerIds.map((passengerId, index) => ({
      passengerId,
      seatId: normalizedSeatIds[index] as string,
    })),
  }
}

export type { Passenger, Reservation, Seat, SeatMap, SeatRow }
