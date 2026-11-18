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
 * The server-side seat primitives and the composed seat-party capability.
 *
 * Each primitive does a single job. `findSeatsForParty` and `assignSeatsForParty` deliberately
 * compose those primitives to find a valid block and move the whole party in one operation.
 * `tests/seat-party.test.ts` holds that composition to its invariants.
 */

export interface SeatPartyBlock {
  row: number
  seatIds: string[]
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
      assignments: Array<Extract<AssignSeatResult, { ok: true }>>
      totalPriceCents: number
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

function seatsFromMap(map: SeatMap): Seat[] {
  return map.rows.flatMap((row) => [...row.left, ...row.right])
}

function isContiguousBlock(seatIds: string[]): boolean {
  if (seatIds.length === 0 || seatIds.length > LEFT_COLUMNS.length) return false

  const parsed = seatIds.map((seatId) => parseSeatId(seatId))
  if (parsed.some((seat) => seat === null)) return false

  const seats = parsed.filter((seat): seat is NonNullable<typeof seat> => seat !== null)
  const row = seats[0]?.row
  if (row === undefined || seats.some((seat) => seat.row !== row)) return false

  const columns = seats.map((seat) => seat.column)
  const side = columns.every((column) => LEFT_COLUMNS.includes(column))
    ? LEFT_COLUMNS
    : columns.every((column) => RIGHT_COLUMNS.includes(column))
      ? RIGHT_COLUMNS
      : null
  if (!side) return false

  const indexes = columns.map((column) => side.indexOf(column)).sort((a, b) => a - b)
  return indexes.every((index, position) => position === 0 || index === indexes[position - 1]! + 1)
}

function partyRestrictionsAreValid(
  restrictions: PassengerRestrictions[],
  seats: Seat[],
): boolean {
  if (restrictions.length !== seats.length) return false

  if (seats.some((seat) => seat.isExitRow)) {
    if (restrictions.some((restriction) => !restriction.canUseExitRow)) return false
  }

  if (restrictions.some((restriction) => restriction.mustSitWithAdult)) {
    return restrictions.some((restriction) => restriction.type === 'adult')
  }

  return true
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

/**
 * Find free, same-row blocks for a party.
 *
 * Blocks never cross the aisle and are ranked by their total additional seat cost.
 */
export async function findSeatsForParty(
  flightId: string,
  passengerIds: string[],
): Promise<SeatPartyBlock[]> {
  const uniquePassengerIds = [...new Set(passengerIds)]
  if (
    uniquePassengerIds.length === 0 ||
    uniquePassengerIds.length !== passengerIds.length ||
    uniquePassengerIds.length > LEFT_COLUMNS.length
  ) {
    return []
  }

  const [map, availableSeatIds, restrictionResults] = await Promise.all([
    getSeatMap(flightId),
    getAvailableSeats(flightId),
    Promise.all(uniquePassengerIds.map((passengerId) => getPassengerRestrictions(passengerId))),
  ])
  if (!map || restrictionResults.some((restriction) => restriction === null)) return []

  const restrictions = restrictionResults.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  const available = new Set(availableSeatIds)
  const candidates: Seat[][] = []

  for (const row of map.rows) {
    for (const side of [row.left, row.right]) {
      for (let start = 0; start <= side.length - uniquePassengerIds.length; start += 1) {
        const seats = side.slice(start, start + uniquePassengerIds.length)
        if (
          seats.length === uniquePassengerIds.length &&
          seats.every((seat) => available.has(seat.id)) &&
          isContiguousBlock(seats.map((seat) => seat.id)) &&
          partyRestrictionsAreValid(restrictions, seats)
        ) {
          candidates.push(seats)
        }
      }
    }
  }

  const blocks = await Promise.all(
    candidates.map(async (seats): Promise<SeatPartyBlock | null> => {
      const prices = await Promise.all(
        seats.map((seat) => calculateSeatPrice(flightId, seat.id)),
      )
      if (prices.some((price) => price === null)) return null

      const totalPriceCents = prices.reduce<number>(
        (total, price) => total + (price ?? 0),
        0,
      )

      return {
        row: seats[0]?.row ?? 0,
        seatIds: seats.map((seat) => seat.id),
        extraCostCents: totalPriceCents,
        totalPriceCents,
      }
    }),
  )

  return blocks
    .filter((block): block is SeatPartyBlock => block !== null)
    .sort(
      (left, right) =>
        left.extraCostCents - right.extraCostCents ||
        (left.seatIds[0] ?? '').localeCompare(right.seatIds[0] ?? '', undefined, {
          numeric: true,
        }),
    )
}

async function restoreAssignments(
  completed: Array<Extract<AssignSeatResult, { ok: true }>>,
): Promise<void> {
  for (const assignment of [...completed].reverse()) {
    if (assignment.previousSeatId && assignment.previousSeatId !== assignment.seatId) {
      await assignSeat(assignment.passengerId, assignment.previousSeatId)
    }
  }
}

export async function assignSeatsForParty(
  assignments: SeatPartyAssignment[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  passengerIds: string[],
  seatIds: string[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  reservationCode: string,
  seatIds: string[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  reservationCode: string,
  assignments: SeatPartyAssignment[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  flightId: string,
  passengerIds: string[],
  seatIds: string[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  reservationOrFlightId: string | string[] | SeatPartyAssignment[],
  seatsOrPassengers?: string[] | SeatPartyAssignment[],
  explicitSeatIds?: string[],
): Promise<AssignSeatsForPartyResult> {
  let flightId: string
  let assignments: SeatPartyAssignment[]
  let reservation: Reservation | null = null

  if (Array.isArray(reservationOrFlightId)) {
    if (reservationOrFlightId.length === 0) {
      return {
        ok: false,
        reason: 'invalid_party_assignments',
        message: 'Choose one different seat for every passenger in the party.',
      }
    }

    if (reservationOrFlightId.every((entry): entry is string => typeof entry === 'string')) {
      if (
        !seatsOrPassengers ||
        !seatsOrPassengers.every((entry): entry is string => typeof entry === 'string') ||
        reservationOrFlightId.length !== seatsOrPassengers.length
      ) {
        return {
          ok: false,
          reason: 'party_size_mismatch',
          message: 'Choose one seat for every passenger in the party.',
        }
      }

      assignments = reservationOrFlightId.map((passengerId, index) => ({
        passengerId,
        seatId: seatsOrPassengers[index] ?? '',
      }))
    } else {
      assignments = reservationOrFlightId as SeatPartyAssignment[]
    }

    const firstPassengerId = assignments[0]?.passengerId
    const firstPassenger = firstPassengerId
      ? await getRepository().getPassenger(firstPassengerId)
      : null
    if (!firstPassenger) {
      return {
        ok: false,
        reason: 'passenger_not_found',
        message: 'We cannot find one of the passengers.',
      }
    }

    reservation = await getReservationByCode(firstPassenger.reservationCode)
    if (!reservation) {
      return {
        ok: false,
        reason: 'reservation_not_found',
        message: 'We cannot find that booking.',
      }
    }
    flightId = reservation.flight.id
  } else if (explicitSeatIds) {
    flightId = reservationOrFlightId
    if (!seatsOrPassengers || seatsOrPassengers.length !== explicitSeatIds.length) {
      return {
        ok: false,
        reason: 'party_size_mismatch',
        message: 'Choose one seat for every passenger in the party.',
      }
    }
    assignments = (seatsOrPassengers as string[]).map((passengerId, index) => ({
      passengerId,
      seatId: explicitSeatIds[index] ?? '',
    }))
  } else {
    reservation = await getReservationByCode(reservationOrFlightId)
    if (!reservation) {
      return {
        ok: false,
        reason: 'reservation_not_found',
        message: 'We cannot find that booking.',
      }
    }

    flightId = reservation.flight.id
    if (!seatsOrPassengers) {
      return {
        ok: false,
        reason: 'invalid_party_assignments',
        message: 'Choose one different seat for every passenger in the party.',
      }
    }

    if (seatsOrPassengers.every((entry): entry is string => typeof entry === 'string')) {
      if (seatsOrPassengers.length !== reservation.passengers.length) {
        return {
          ok: false,
          reason: 'party_size_mismatch',
          message: 'Choose one seat for every passenger in the party.',
        }
      }
      assignments = reservation.passengers.map((passenger, index) => ({
        passengerId: passenger.id,
        seatId: seatsOrPassengers[index] ?? '',
      }))
    } else {
      assignments = seatsOrPassengers as SeatPartyAssignment[]
    }
  }

  const normalizedAssignments = assignments.map((assignment) => ({
    passengerId: assignment.passengerId,
    seatId: assignment.seatId.trim().toUpperCase(),
  }))
  const passengerIds = normalizedAssignments.map((assignment) => assignment.passengerId)
  const seatIds = normalizedAssignments.map((assignment) => assignment.seatId)

  if (
    normalizedAssignments.length === 0 ||
    new Set(passengerIds).size !== normalizedAssignments.length ||
    new Set(seatIds).size !== normalizedAssignments.length
  ) {
    return {
      ok: false,
      reason: 'invalid_party_assignments',
      message: 'Choose one different seat for every passenger in the party.',
    }
  }

  if (reservation) {
    const reservationPassengerIds = new Set(
      reservation.passengers.map((passenger) => passenger.id),
    )
    if (
      normalizedAssignments.length !== reservation.passengers.length ||
      normalizedAssignments.some(
        (assignment) => !reservationPassengerIds.has(assignment.passengerId),
      )
    ) {
      return {
        ok: false,
        reason: 'party_size_mismatch',
        message: 'Choose one seat for every passenger on this booking.',
      }
    }
  }

  if (!isContiguousBlock(seatIds)) {
    return {
      ok: false,
      reason: 'seats_not_together',
      message: 'Choose consecutive seats in one row on the same side of the aisle.',
    }
  }

  const [map, restrictionResults] = await Promise.all([
    getSeatMap(flightId),
    Promise.all(
      normalizedAssignments.map((assignment) =>
        getPassengerRestrictions(assignment.passengerId),
      ),
    ),
  ])
  if (!map) {
    return {
      ok: false,
      reason: 'flight_not_found',
      message: 'We cannot find that flight.',
    }
  }
  if (restrictionResults.some((restriction) => restriction === null)) {
    return {
      ok: false,
      reason: 'passenger_not_found',
      message: 'We cannot find one of the passengers.',
    }
  }

  const seatById = new Map(seatsFromMap(map).map((seat) => [seat.id, seat]))
  const selectedSeats = seatIds
    .map((seatId) => seatById.get(seatId))
    .filter((seat): seat is Seat => seat !== undefined)

  if (selectedSeats.length !== normalizedAssignments.length) {
    return {
      ok: false,
      reason: 'seat_not_found',
      message: 'One of those seats is not on this aircraft.',
    }
  }

  const partyPassengerIds = new Set(passengerIds)
  for (const seat of selectedSeats) {
    if (seat.baseState === 'blocked') {
      return {
        ok: false,
        reason: 'seat_blocked',
        message: `Seat ${seat.id} is held for a customer who needs accessible seating. Please pick another block.`,
      }
    }
    if (
      seat.baseState === 'booked' ||
      (seat.occupantPassengerId !== null &&
        !partyPassengerIds.has(seat.occupantPassengerId))
    ) {
      return {
        ok: false,
        reason: 'seat_booked',
        message: `Seat ${seat.id} is already taken. Please pick another block.`,
      }
    }
  }

  const restrictions = restrictionResults.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  if (!partyRestrictionsAreValid(restrictions, selectedSeats)) {
    return {
      ok: false,
      reason: selectedSeats.some((seat) => seat.isExitRow)
        ? 'exit_row_child'
        : 'child_requires_adult',
      message: selectedSeats.some((seat) => seat.isExitRow)
        ? 'Exit rows are for adults only. Please pick another block.'
        : 'A child under 13 must sit with an adult on the same booking.',
    }
  }

  const prices = await Promise.all(
    selectedSeats.map((seat) => calculateSeatPrice(flightId, seat.id)),
  )
  if (prices.some((price) => price === null)) {
    return {
      ok: false,
      reason: 'seat_not_found',
      message: 'One of those seats is not on this aircraft.',
    }
  }

  const completed: Array<Extract<AssignSeatResult, { ok: true }>> = []
  try {
    for (const assignment of normalizedAssignments) {
      const result = await assignSeat(assignment.passengerId, assignment.seatId)
      if (!result.ok) {
        await restoreAssignments(completed)
        return result
      }
      completed.push(result)
    }
  } catch {
    await restoreAssignments(completed)
    return {
      ok: false,
      reason: 'assignment_failed',
      message: 'We could not save seats for the whole party. No seats were changed.',
    }
  }

  return {
    ok: true,
    assignments: completed,
    totalPriceCents: prices.reduce<number>(
      (total, price) => total + (price ?? 0),
      0,
    ),
  }
}

export type { Passenger, Reservation, Seat, SeatMap, SeatRow }
