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
 * The server-side seat primitives and seat-party compositions.
 *
 * The single-passenger primitives each do one job. The party capabilities compose those primitives
 * to find contiguous seats and apply every assignment together.
 *
 * `AGENTS.md`, under "Adding seat-party capabilities", describes the invariants, and
 * `tests/seat-party.test.ts` enforces them.
 */

export interface SeatPartyOption {
  row: number
  seatIds: string[]
  extraCostCents: number
  totalPriceCents: number
}

export interface SeatPartyAssignment {
  passengerId: string
  seatId: string
}

type SuccessfulAssignment = Extract<AssignSeatResult, { ok: true }>

export type AssignSeatsForPartyResult =
  | {
      ok: true
      assignments: SuccessfulAssignment[]
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

/**
 * Find contiguous same-row blocks for a party.
 *
 * A party's current seats may be included in a block. Seats held by anybody outside the party,
 * booked seats and seats held for accessible seating are never offered.
 */
export async function findSeatsForParty(
  flightId: string,
  passengerIds: string[],
): Promise<SeatPartyOption[]> {
  const uniquePassengerIds = [...new Set(passengerIds)]
  if (
    uniquePassengerIds.length === 0 ||
    uniquePassengerIds.length !== passengerIds.length ||
    uniquePassengerIds.length > LEFT_COLUMNS.length
  ) {
    return []
  }

  const [seatMap, restrictions] = await Promise.all([
    getSeatMap(flightId),
    Promise.all(uniquePassengerIds.map((passengerId) => getPassengerRestrictions(passengerId))),
  ])
  if (!seatMap || restrictions.some((restriction) => restriction === null)) return []

  const passengerRestrictions = restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  const hasAdult = passengerRestrictions.some((restriction) => restriction.type === 'adult')
  if (
    passengerRestrictions.some((restriction) => restriction.mustSitWithAdult) &&
    !hasAdult
  ) {
    return []
  }

  const partyIds = new Set(uniquePassengerIds)
  const partyCanUseExitRows = passengerRestrictions.every(
    (restriction) => restriction.canUseExitRow,
  )
  const options: SeatPartyOption[] = []

  for (const row of seatMap.rows) {
    if (row.isExitRow && !partyCanUseExitRows) continue

    for (const side of [row.left, row.right]) {
      for (let start = 0; start <= side.length - uniquePassengerIds.length; start += 1) {
        const block = side.slice(start, start + uniquePassengerIds.length)
        const canUseBlock = block.every(
          (seat) =>
            seat.baseState === 'available' &&
            (!seat.occupantPassengerId || partyIds.has(seat.occupantPassengerId)),
        )
        if (!canUseBlock) continue

        const prices = await Promise.all(
          block.map((seat) => calculateSeatPrice(flightId, seat.id)),
        )
        if (prices.some((price) => price === null)) continue

        const extraCostCents = prices.reduce<number>(
          (total, price) => total + (price ?? 0),
          0,
        )

        options.push({
          row: row.row,
          seatIds: block.map((seat) => seat.id),
          extraCostCents,
          totalPriceCents: extraCostCents,
        })
      }
    }
  }

  return options.sort((left, right) => left.extraCostCents - right.extraCostCents)
}

/**
 * Move a party into one contiguous block.
 *
 * Every assignment is validated before the first write. Writes are ordered so occupied party seats
 * are vacated first. If a write fails, completed writes are reversed before the failure is returned.
 */
export function assignSeatsForParty(
  passengerIds: string[],
  seatIds: string[],
): Promise<AssignSeatsForPartyResult>
export function assignSeatsForParty(
  flightId: string,
  assignments: SeatPartyAssignment[],
): Promise<AssignSeatsForPartyResult>
export function assignSeatsForParty(
  flightId: string,
  passengerIds: string[],
  seatIds: string[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  flightIdOrPassengerIds: string | string[],
  assignmentsOrPassengerIds: SeatPartyAssignment[] | string[],
  requestedSeatIds?: string[],
): Promise<AssignSeatsForPartyResult> {
  const passengerAndSeatIdsOnly = Array.isArray(flightIdOrPassengerIds)
  let flightId = passengerAndSeatIdsOnly ? '' : flightIdOrPassengerIds

  const assignments: SeatPartyAssignment[] = passengerAndSeatIdsOnly
    ? flightIdOrPassengerIds.map((passengerId, index) => ({
        passengerId,
        seatId:
          typeof assignmentsOrPassengerIds[index] === 'string'
            ? assignmentsOrPassengerIds[index]
            : '',
      }))
    : requestedSeatIds === undefined
      ? assignmentsOrPassengerIds.map((assignment) =>
          typeof assignment === 'string'
            ? { passengerId: assignment, seatId: '' }
            : assignment,
        )
      : assignmentsOrPassengerIds.map((passengerId, index) => ({
          passengerId: typeof passengerId === 'string' ? passengerId : passengerId.passengerId,
          seatId: requestedSeatIds[index] ?? '',
        }))

  const suppliedSeatIds = passengerAndSeatIdsOnly
    ? assignmentsOrPassengerIds
    : requestedSeatIds

  if (
    assignments.length === 0 ||
    (suppliedSeatIds !== undefined && suppliedSeatIds.length !== assignments.length)
  ) {
    return {
      ok: false,
      reason: 'assignments_required',
      message: 'Choose passengers and seats before saving.',
    }
  }

  if (
    assignments.some(
      (assignment) =>
        typeof assignment.passengerId !== 'string' ||
        assignment.passengerId.trim().length === 0 ||
        typeof assignment.seatId !== 'string' ||
        assignment.seatId.trim().length === 0,
    )
  ) {
    return {
      ok: false,
      reason: 'assignments_required',
      message: 'Choose one seat for each passenger before saving.',
    }
  }

  const normalizedAssignments = assignments.map((assignment) => ({
    passengerId: assignment.passengerId.trim(),
    seatId: assignment.seatId.trim().toUpperCase(),
  }))
  const passengerIds = normalizedAssignments.map((assignment) => assignment.passengerId)
  const seatIds = normalizedAssignments.map((assignment) => assignment.seatId)

  if (new Set(passengerIds).size !== passengerIds.length) {
    return {
      ok: false,
      reason: 'duplicate_passenger',
      message: 'Choose one seat for each passenger.',
    }
  }
  if (new Set(seatIds).size !== seatIds.length) {
    return {
      ok: false,
      reason: 'duplicate_seat',
      message: 'Choose a different seat for each passenger.',
    }
  }

  if (passengerAndSeatIdsOnly) {
    const repository = getRepository()
    const passenger = await repository.getPassenger(passengerIds[0] ?? '')
    if (!passenger) {
      return {
        ok: false,
        reason: 'passenger_not_found',
        message: 'We cannot find one of those passengers.',
      }
    }

    const reservation = await repository.getReservationByCode(passenger.reservationCode)
    if (!reservation) {
      return {
        ok: false,
        reason: 'passenger_not_found',
        message: 'We cannot find one of those passengers.',
      }
    }

    flightId = reservation.flightId
  }

  const [seatMap, restrictions] = await Promise.all([
    getSeatMap(flightId),
    Promise.all(passengerIds.map((passengerId) => getPassengerRestrictions(passengerId))),
  ])
  if (!seatMap) {
    return {
      ok: false,
      reason: 'flight_not_found',
      message: 'We cannot find that flight.',
    }
  }
  if (restrictions.some((restriction) => restriction === null)) {
    return {
      ok: false,
      reason: 'passenger_not_found',
      message: 'We cannot find one of those passengers.',
    }
  }

  const seatById = new Map<string, Seat>()
  for (const row of seatMap.rows) {
    for (const seat of [...row.left, ...row.right]) seatById.set(seat.id, seat)
  }

  const targetSeats = seatIds.map((seatId) => seatById.get(seatId))
  if (targetSeats.some((seat) => seat === undefined)) {
    const missingSeatId = seatIds.find((seatId) => !seatById.has(seatId)) ?? ''
    return {
      ok: false,
      reason: 'seat_not_found',
      message: `Seat ${missingSeatId} is not on this aircraft.`,
    }
  }

  const seats = targetSeats.filter((seat): seat is Seat => seat !== undefined)
  const row = seats[0]?.row
  const side =
    seats[0] && LEFT_COLUMNS.includes(seats[0].column)
      ? LEFT_COLUMNS
      : RIGHT_COLUMNS
  const columnIndexes = seats
    .map((seat) => side.indexOf(seat.column))
    .sort((left, right) => left - right)
  const contiguous =
    seats.every((seat) => seat.row === row && side.includes(seat.column)) &&
    columnIndexes.every(
      (columnIndex, index) =>
        index === 0 || columnIndex === columnIndexes[index - 1]! + 1,
    )

  if (!contiguous) {
    return {
      ok: false,
      reason: 'seats_not_together',
      message: 'Choose consecutive seats in one row on the same side of the aisle.',
    }
  }

  const partyIds = new Set(passengerIds)
  for (const seat of seats) {
    if (seat.baseState === 'blocked') {
      return {
        ok: false,
        reason: 'seat_blocked',
        message: `Seat ${seat.id} is held for a customer who needs accessible seating. Please pick another seat.`,
      }
    }
    if (
      seat.baseState === 'booked' ||
      (seat.occupantPassengerId && !partyIds.has(seat.occupantPassengerId))
    ) {
      return {
        ok: false,
        reason: 'seat_booked',
        message: `Seat ${seat.id} is already taken. Please pick another seat.`,
      }
    }
  }

  const passengerRestrictions = restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  const hasAdult = passengerRestrictions.some((restriction) => restriction.type === 'adult')
  if (
    passengerRestrictions.some((restriction) => restriction.mustSitWithAdult) &&
    !hasAdult
  ) {
    return {
      ok: false,
      reason: 'adult_required',
      message: 'A child under 13 must sit with an adult on the same booking.',
    }
  }

  for (let index = 0; index < normalizedAssignments.length; index += 1) {
    const seat = seats[index]
    const restriction = passengerRestrictions[index]
    if (seat?.isExitRow && restriction && !restriction.canUseExitRow) {
      return {
        ok: false,
        reason: 'exit_row_child',
        message: `Seat ${seat.id} is in an exit row. Exit rows are for adults only.`,
      }
    }
  }

  const occupantBySeat = new Map<string, string>()
  const currentSeatByPassenger = new Map<string, string>()
  for (const seat of seatById.values()) {
    if (!seat.occupantPassengerId) continue
    occupantBySeat.set(seat.id, seat.occupantPassengerId)
    currentSeatByPassenger.set(seat.occupantPassengerId, seat.id)
  }

  const remaining = [...normalizedAssignments]
  const ordered: SeatPartyAssignment[] = []
  while (remaining.length > 0) {
    const movableIndex = remaining.findIndex((assignment) => {
      const occupant = occupantBySeat.get(assignment.seatId)
      return !occupant || occupant === assignment.passengerId
    })
    if (movableIndex === -1) {
      return {
        ok: false,
        reason: 'assignment_cycle',
        message: 'Those seats cannot be swapped safely. Please choose another block.',
      }
    }

    const [assignment] = remaining.splice(movableIndex, 1)
    if (!assignment) break

    const currentSeatId = currentSeatByPassenger.get(assignment.passengerId)
    if (currentSeatId) occupantBySeat.delete(currentSeatId)
    occupantBySeat.set(assignment.seatId, assignment.passengerId)
    currentSeatByPassenger.set(assignment.passengerId, assignment.seatId)
    ordered.push(assignment)
  }

  const completed: SuccessfulAssignment[] = []
  for (const assignment of ordered) {
    const result = await assignSeat(assignment.passengerId, assignment.seatId)
    if (!result.ok) {
      for (const completedAssignment of [...completed].reverse()) {
        if (completedAssignment.previousSeatId) {
          await assignSeat(
            completedAssignment.passengerId,
            completedAssignment.previousSeatId,
          )
        }
      }
      return result
    }
    completed.push(result)
  }

  return {
    ok: true,
    assignments: completed,
    totalPriceCents: completed.reduce(
      (total, assignment) => total + assignment.priceCents,
      0,
    ),
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
