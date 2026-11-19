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
 * The server-side seat primitives and seat-party composition.
 *
 * The party capability composes the existing primitives to find ranked blocks on one side of the
 * aisle and apply every passenger assignment as one operation. If any assignment fails, completed
 * moves are rolled back before the failure is returned.
 */

export interface SeatPartyOption {
  seatIds: string[]
  row: number
  extraCostCents: number
  totalPriceCents: number
}

export interface SeatPartyAssignment {
  passengerId: string
  seatId: string
}

export type AssignSeatsForPartyResult =
  | {
      ok: true
      assignments: Extract<AssignSeatResult, { ok: true }>[]
      totalPriceCents: number
    }
  | {
      ok: false
      reason:
        | 'invalid_party'
        | 'invalid_block'
        | 'seats_unavailable'
        | 'passenger_not_found'
        | 'seat_not_found'
        | 'seat_booked'
        | 'seat_blocked'
        | 'exit_row_child'
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
 * Find available contiguous seats for a party.
 *
 * Every option is in one row, stays on one side of the aisle, satisfies the passenger
 * restrictions, and is ranked by total extra cost.
 */
export async function findSeatsForParty(
  flightId: string,
  passengerIds: string[],
): Promise<SeatPartyOption[]> {
  if (
    passengerIds.length === 0 ||
    passengerIds.length > LEFT_COLUMNS.length ||
    new Set(passengerIds).size !== passengerIds.length
  ) {
    return []
  }

  const [seatMap, availableSeatIds, restrictions] = await Promise.all([
    getSeatMap(flightId),
    getAvailableSeats(flightId),
    Promise.all(passengerIds.map((passengerId) => getPassengerRestrictions(passengerId))),
  ])

  if (!seatMap || restrictions.some((restriction) => restriction === null)) return []

  const passengerRestrictions = restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  const hasAdult = passengerRestrictions.some((restriction) => restriction.type === 'adult')
  if (passengerRestrictions.some((restriction) => restriction.mustSitWithAdult) && !hasAdult) {
    return []
  }

  const available = new Set(availableSeatIds)
  const options: SeatPartyOption[] = []

  for (const row of seatMap.rows) {
    if (
      row.isExitRow &&
      passengerRestrictions.some((restriction) => !restriction.canUseExitRow)
    ) {
      continue
    }

    for (const side of [row.left, row.right]) {
      for (let start = 0; start <= side.length - passengerIds.length; start += 1) {
        const seats = side.slice(start, start + passengerIds.length)
        if (seats.length !== passengerIds.length) continue
        if (seats.some((seat) => seat.state !== 'available' || !available.has(seat.id))) continue

        const prices = await Promise.all(
          seats.map((seat) => calculateSeatPrice(flightId, seat.id)),
        )
        if (prices.some((price) => price === null)) continue

        const extraCostCents = prices.reduce<number>(
          (total, price) => total + (price ?? 0),
          0,
        )

        options.push({
          seatIds: seats.map((seat) => seat.id),
          row: row.row,
          extraCostCents,
          totalPriceCents: extraCostCents,
        })
      }
    }
  }

  return options.sort((left, right) => {
    if (left.extraCostCents !== right.extraCostCents) {
      return left.extraCostCents - right.extraCostCents
    }

    if (left.row !== right.row) return left.row - right.row

    const leftSeat = parseSeatId(left.seatIds[0] ?? '')
    const rightSeat = parseSeatId(right.seatIds[0] ?? '')
    if (!leftSeat || !rightSeat) return 0
    return leftSeat.column.localeCompare(rightSeat.column)
  })
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

async function getPartyFlightId(passengerIds: string[]): Promise<string | null> {
  if (passengerIds.length === 0) return null

  const repository = getRepository()
  const passengers = await Promise.all(
    passengerIds.map((passengerId) => repository.getPassenger(passengerId)),
  )
  if (passengers.some((passenger) => passenger === null)) return null

  const reservationCodes = new Set(
    passengers.map((passenger) => passenger?.reservationCode).filter(Boolean),
  )
  if (reservationCodes.size !== 1) return null

  const reservationCode = passengers[0]?.reservationCode
  if (!reservationCode) return null

  const reservation = await repository.getReservationByCode(reservationCode)
  return reservation?.flightId ?? null
}

export async function assignSeatsForParty(
  flightId: string,
  passengerIds: string[],
  seatIds: string[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  flightId: string,
  assignments: SeatPartyAssignment[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  passengerIds: string[],
  seatIds: string[],
): Promise<AssignSeatsForPartyResult>
/**
 * Assign a contiguous block to a party, rolling back completed moves if any assignment fails.
 */
export async function assignSeatsForParty(
  flightIdOrPassengerIds: string | string[],
  assignmentsOrPassengerIds: SeatPartyAssignment[] | string[],
  requestedSeatIds?: string[],
): Promise<AssignSeatsForPartyResult> {
  let flightId: string
  let assignments: SeatPartyAssignment[]

  if (Array.isArray(flightIdOrPassengerIds)) {
    const passengerIds = flightIdOrPassengerIds
    const seatIds = assignmentsOrPassengerIds as string[]
    const inferredFlightId = await getPartyFlightId(passengerIds)

    if (!inferredFlightId) {
      return {
        ok: false,
        reason: 'invalid_party',
        message: 'Choose passengers from the same booking.',
      }
    }

    flightId = inferredFlightId
    assignments = passengerIds.map((passengerId, index) => ({
      passengerId,
      seatId: seatIds[index] ?? '',
    }))
  } else {
    flightId = flightIdOrPassengerIds
    assignments =
      requestedSeatIds === undefined
        ? (assignmentsOrPassengerIds as SeatPartyAssignment[])
        : (assignmentsOrPassengerIds as string[]).map((passengerId, index) => ({
            passengerId,
            seatId: requestedSeatIds[index] ?? '',
          }))
  }

  if (
    assignments.length === 0 ||
    assignments.some((assignment) => !assignment.passengerId || !assignment.seatId) ||
    new Set(assignments.map((assignment) => assignment.passengerId)).size !== assignments.length ||
    new Set(assignments.map((assignment) => assignment.seatId.trim().toUpperCase())).size !==
      assignments.length
  ) {
    return {
      ok: false,
      reason: 'invalid_party',
      message: 'Choose one seat for each passenger in your party.',
    }
  }

  const passengerIds = assignments.map((assignment) => assignment.passengerId)
  const seatIds = assignments.map((assignment) => assignment.seatId.trim().toUpperCase())
  const options = await findSeatsForParty(flightId, passengerIds)
  const requestedKey = [...seatIds].sort().join('|')
  const selectedOption = options.find(
    (option) => [...option.seatIds].sort().join('|') === requestedKey,
  )

  if (!selectedOption) {
    return {
      ok: false,
      reason: 'invalid_block',
      message: 'Those seats are not available together. Please choose another option.',
    }
  }

  const completed: Extract<AssignSeatResult, { ok: true }>[] = []

  for (let index = 0; index < assignments.length; index += 1) {
    const assignment = assignments[index]
    const seatId = seatIds[index]
    if (!assignment || !seatId) {
      return {
        ok: false,
        reason: 'invalid_party',
        message: 'Choose one seat for each passenger in your party.',
      }
    }

    const result = await assignSeat(assignment.passengerId, seatId)
    if (!result.ok) {
      for (const completedAssignment of [...completed].reverse()) {
        if (completedAssignment.previousSeatId) {
          await assignSeat(completedAssignment.passengerId, completedAssignment.previousSeatId)
        }
      }

      return {
        ok: false,
        reason: result.reason,
        message: result.message,
      }
    }

    completed.push(result)
  }

  return {
    ok: true,
    assignments: completed,
    totalPriceCents: selectedOption.totalPriceCents,
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

export type { Passenger, Reservation, Seat, SeatMap, SeatRow }
