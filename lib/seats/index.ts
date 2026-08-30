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
 * The server-side seat primitives and the seat-party composition.
 *
 * The party capability deliberately builds on the single-purpose primitives below. It finds
 * contiguous seats on one side of the aisle, applies every passenger move as one operation, and
 * restores the party's previous assignments if an apply fails.
 */

export interface SeatPartyOption {
  row: number
  seatIds: string[]
  seats: string[]
  extraCostCents: number
  totalPriceCents: number
}

export interface PartySeatAssignment {
  passengerId: string
  seatId: string
}

export type AssignSeatsForPartyResult =
  | {
      ok: true
      assignments: AssignSeatResult[]
      seatIds: string[]
      seats: string[]
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
 * It moves one passenger. Party moves are composed by `assignSeatsForParty`.
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

async function resolvePassengerIds(
  flightId: string,
  passengerIdsOrReservationCode: readonly string[] | string,
): Promise<string[] | null> {
  if (typeof passengerIdsOrReservationCode !== 'string') {
    return passengerIdsOrReservationCode.map((passengerId) => passengerId.trim()).filter(Boolean)
  }

  const reservation = await getReservationByCode(passengerIdsOrReservationCode)
  if (!reservation || reservation.flight.id !== flightId) return null
  return reservation.passengers.map((passenger) => passenger.id)
}

async function restrictionsForParty(
  passengerIds: readonly string[],
): Promise<PassengerRestrictions[] | null> {
  if (passengerIds.length === 0 || new Set(passengerIds).size !== passengerIds.length) return null

  const restrictions = await Promise.all(
    passengerIds.map((passengerId) => getPassengerRestrictions(passengerId)),
  )
  if (restrictions.some((restriction) => restriction === null)) return null
  return restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
}

function partyMeetsAdultRule(restrictions: readonly PassengerRestrictions[]): boolean {
  const hasAdult = restrictions.some((restriction) => restriction.type === 'adult')
  return restrictions.every((restriction) => !restriction.mustSitWithAdult || hasAdult)
}

async function priceBlock(flightId: string, seats: readonly Seat[]): Promise<number | null> {
  const prices = await Promise.all(seats.map((seat) => calculateSeatPrice(flightId, seat.id)))
  if (prices.some((price) => price === null)) return null
  return prices.reduce<number>((total, price) => total + (price ?? 0), 0)
}

/**
 * Find available blocks that can seat a party together.
 *
 * Every option is consecutive in one row and on one side of the aisle. Options obey each
 * passenger's restrictions and are ordered by their total extra cost.
 */
export async function findSeatsForParty(
  flightId: string,
  passengerIds: readonly string[],
): Promise<SeatPartyOption[]>
export async function findSeatsForParty(
  flightId: string,
  reservationCode: string,
): Promise<SeatPartyOption[]>
export async function findSeatsForParty(
  flightId: string,
  passengerIdsOrReservationCode: readonly string[] | string,
): Promise<SeatPartyOption[]> {
  const passengerIds = await resolvePassengerIds(flightId, passengerIdsOrReservationCode)
  if (!passengerIds) return []

  const [map, restrictions] = await Promise.all([
    getSeatMap(flightId),
    restrictionsForParty(passengerIds),
  ])
  if (!map || !restrictions || !partyMeetsAdultRule(restrictions)) return []

  const partySize = passengerIds.length
  const options: SeatPartyOption[] = []

  for (const row of map.rows) {
    if (row.isExitRow && restrictions.some((restriction) => !restriction.canUseExitRow)) continue

    for (const side of [row.left, row.right]) {
      for (let start = 0; start + partySize <= side.length; start += 1) {
        const block = side.slice(start, start + partySize)
        if (block.length !== partySize || block.some((seat) => seat.state !== 'available')) continue

        const totalPriceCents = await priceBlock(flightId, block)
        if (totalPriceCents === null) continue

        const seatIds = block.map((seat) => seat.id)
        options.push({
          row: row.row,
          seatIds,
          seats: [...seatIds],
          extraCostCents: totalPriceCents,
          totalPriceCents,
        })
      }
    }
  }

  return options.sort(
    (left, right) =>
      left.extraCostCents - right.extraCostCents ||
      left.seatIds.join(',').localeCompare(right.seatIds.join(','), undefined, { numeric: true }),
  )
}

function seatsFormContiguousBlock(map: SeatMap, seatIds: readonly string[]): boolean {
  if (seatIds.length === 0) return false
  const wanted = new Set(seatIds)

  for (const row of map.rows) {
    for (const side of [row.left, row.right]) {
      for (let start = 0; start + seatIds.length <= side.length; start += 1) {
        const block = side.slice(start, start + seatIds.length)
        if (block.every((seat) => wanted.has(seat.id))) return true
      }
    }
  }

  return false
}

function normalizeAssignments(
  assignments: readonly PartySeatAssignment[],
): PartySeatAssignment[] {
  return assignments.map((assignment) => ({
    passengerId: assignment.passengerId.trim(),
    seatId: assignment.seatId.trim().toUpperCase(),
  }))
}

async function assignmentsFromInputs(
  flightId: string,
  assignmentsOrPassengerIds: readonly PartySeatAssignment[] | readonly string[] | string,
  seatIds?: readonly string[],
): Promise<PartySeatAssignment[] | null> {
  if (typeof assignmentsOrPassengerIds === 'string') {
    if (!seatIds) return null
    const passengerIds = await resolvePassengerIds(flightId, assignmentsOrPassengerIds)
    if (!passengerIds || passengerIds.length !== seatIds.length) return null
    return passengerIds.map((passengerId, index) => ({
      passengerId,
      seatId: seatIds[index] ?? '',
    }))
  }

  if (seatIds) {
    const passengerIds = assignmentsOrPassengerIds as readonly string[]
    if (passengerIds.length !== seatIds.length) return null
    return passengerIds.map((passengerId, index) => ({
      passengerId,
      seatId: seatIds[index] ?? '',
    }))
  }

  return [...(assignmentsOrPassengerIds as readonly PartySeatAssignment[])]
}

async function flightIdForPassengers(passengerIds: readonly string[]): Promise<string | null> {
  if (passengerIds.length === 0) return null

  const repository = getRepository()
  const passengers = await Promise.all(
    passengerIds.map((passengerId) => repository.getPassenger(passengerId.trim())),
  )
  if (passengers.some((passenger) => passenger === null)) return null

  const reservationCodes = new Set(
    passengers.map((passenger) => passenger?.reservationCode).filter(Boolean),
  )
  if (reservationCodes.size !== 1) return null

  const reservationCode = [...reservationCodes][0]
  if (!reservationCode) return null

  const reservation = await repository.getReservationByCode(reservationCode)
  return reservation?.flightId ?? null
}

export async function assignSeatsForParty(
  flightId: string,
  assignments: readonly PartySeatAssignment[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  flightId: string,
  passengerIds: readonly string[],
  seatIds: readonly string[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  flightId: string,
  reservationCode: string,
  seatIds: readonly string[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  passengerIds: readonly string[],
  seatIds: readonly string[],
): Promise<AssignSeatsForPartyResult>
/**
 * Move a party into one valid block.
 *
 * The complete request is validated before the first write. If a write still loses a race, every
 * completed move is compensated in reverse order so the party keeps its previous assignments.
 */
export async function assignSeatsForParty(
  flightIdOrPassengerIds: string | readonly string[],
  assignmentsOrPassengerIds: readonly PartySeatAssignment[] | readonly string[] | string,
  seatIds?: readonly string[],
): Promise<AssignSeatsForPartyResult> {
  let flightId: string
  let input: PartySeatAssignment[] | null

  if (typeof flightIdOrPassengerIds === 'string') {
    flightId = flightIdOrPassengerIds
    input = await assignmentsFromInputs(
      flightId,
      assignmentsOrPassengerIds,
      seatIds,
    )
  } else {
    const passengerIds = flightIdOrPassengerIds.map((passengerId) => passengerId.trim())
    const targetSeatIds = assignmentsOrPassengerIds as readonly string[]
    flightId = (await flightIdForPassengers(passengerIds)) ?? ''
    input =
      flightId && passengerIds.length === targetSeatIds.length
        ? passengerIds.map((passengerId, index) => ({
            passengerId,
            seatId: targetSeatIds[index] ?? '',
          }))
        : null
  }

  if (!input) {
    return {
      ok: false,
      reason: 'invalid_party',
      message: 'We could not match the travelers to those seats.',
    }
  }

  const assignments = normalizeAssignments(input)
  if (
    assignments.length === 0 ||
    assignments.some((assignment) => !assignment.passengerId || !assignment.seatId) ||
    new Set(assignments.map((assignment) => assignment.passengerId)).size !== assignments.length ||
    new Set(assignments.map((assignment) => assignment.seatId)).size !== assignments.length
  ) {
    return {
      ok: false,
      reason: 'invalid_party',
      message: 'Each traveler and seat must appear exactly once.',
    }
  }

  const passengerIds = assignments.map((assignment) => assignment.passengerId)
  const targetSeatIds = assignments.map((assignment) => assignment.seatId)
  const [map, restrictions] = await Promise.all([
    getSeatMap(flightId),
    restrictionsForParty(passengerIds),
  ])

  if (!map) {
    return {
      ok: false,
      reason: 'flight_not_found',
      message: 'We cannot find that flight.',
    }
  }
  if (!restrictions) {
    return {
      ok: false,
      reason: 'passenger_not_found',
      message: 'We cannot find one or more travelers.',
    }
  }

  const passengerFlightIds = await Promise.all(
    passengerIds.map(async (passengerId) => {
      const passenger = await getRepository().getPassenger(passengerId)
      if (!passenger) return null
      const reservation = await getRepository().getReservationByCode(passenger.reservationCode)
      return reservation?.flightId ?? null
    }),
  )
  if (passengerFlightIds.some((passengerFlightId) => passengerFlightId !== flightId)) {
    return {
      ok: false,
      reason: 'passenger_not_found',
      message: 'We cannot find one or more travelers on that flight.',
    }
  }

  if (!partyMeetsAdultRule(restrictions)) {
    return {
      ok: false,
      reason: 'adult_required',
      message: 'A child under 13 must be seated with an adult on the same booking.',
    }
  }

  const seatById = new Map<string, Seat>()
  for (const row of map.rows) {
    for (const seat of [...row.left, ...row.right]) seatById.set(seat.id, seat)
  }

  for (const seatId of targetSeatIds) {
    if (!seatById.has(seatId)) {
      return {
        ok: false,
        reason: 'seat_not_found',
        message: `Seat ${seatId} is not on this aircraft.`,
      }
    }
  }

  if (!seatsFormContiguousBlock(map, targetSeatIds)) {
    return {
      ok: false,
      reason: 'seats_not_together',
      message: 'Choose consecutive seats in one row on the same side of the aisle.',
    }
  }

  for (const assignment of assignments) {
    const seat = seatById.get(assignment.seatId)
    if (!seat) {
      return {
        ok: false,
        reason: 'seat_not_found',
        message: `Seat ${assignment.seatId} is not on this aircraft.`,
      }
    }
    if (
      seat.state !== 'available' &&
      !(seat.state === 'occupied' && seat.occupantPassengerId === assignment.passengerId)
    ) {
      return {
        ok: false,
        reason: seat.state === 'blocked' ? 'seat_blocked' : 'seat_booked',
        message:
          seat.state === 'blocked'
            ? `Seat ${seat.id} is held for a customer who needs accessible seating. Please choose another block.`
            : `Seat ${seat.id} is already taken. Please choose another block.`,
      }
    }

    const restriction = restrictions.find(
      (candidate) => candidate.passengerId === assignment.passengerId,
    )
    if (seat.isExitRow && !restriction?.canUseExitRow) {
      return {
        ok: false,
        reason: 'exit_row_child',
        message: `Seat ${seat.id} is in an exit row. Exit rows are for adults only.`,
      }
    }
  }

  const totalPrices = await Promise.all(
    targetSeatIds.map((seatId) => calculateSeatPrice(flightId, seatId)),
  )
  if (totalPrices.some((price) => price === null)) {
    return {
      ok: false,
      reason: 'seat_not_found',
      message: 'One or more seats are not on this aircraft.',
    }
  }

  const previousSeatByPassenger = new Map<string, string | null>(
    assignments.map((assignment) => {
      const previous = [...seatById.values()].find(
        (seat) => seat.occupantPassengerId === assignment.passengerId,
      )
      return [assignment.passengerId, previous?.id ?? null]
    }),
  )

  const completed: AssignSeatResult[] = []
  for (const assignment of assignments) {
    const result = await assignSeat(assignment.passengerId, assignment.seatId)
    if (!result.ok) {
      for (const completedResult of [...completed].reverse()) {
        if (!completedResult.ok) continue
        const previousSeatId = previousSeatByPassenger.get(completedResult.passengerId)
        if (previousSeatId && previousSeatId !== completedResult.seatId) {
          await assignSeat(completedResult.passengerId, previousSeatId)
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
    seatIds: targetSeatIds,
    seats: [...targetSeatIds],
    totalPriceCents: totalPrices.reduce<number>(
      (total, price) => total + (price ?? 0),
      0,
    ),
  }
}

export type { Passenger, Reservation, Seat, SeatMap, SeatRow }
