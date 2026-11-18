import { NextResponse } from 'next/server'
import {
  assignSeatsForParty,
  findSeatsForParty,
  getReservationByCode,
} from '../../../../../lib/seats'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ flightId: string }>
}

function errorResponse(error: string, message: string, status: number) {
  return NextResponse.json({ error, message }, { status })
}

function assignmentFailureStatus(reason: string): number {
  switch (reason) {
    case 'reservation_not_found':
    case 'flight_not_found':
    case 'passenger_not_found':
    case 'seat_not_found':
      return 404
    case 'seat_booked':
    case 'seat_blocked':
    case 'assignment_failed':
      return 409
    case 'party_size_mismatch':
    case 'invalid_party_assignments':
    case 'seats_not_together':
    case 'exit_row_child':
    case 'child_requires_adult':
      return 422
    default:
      return 400
  }
}

export async function GET(request: Request, context: RouteContext) {
  const { flightId } = await context.params
  const reservationCode = new URL(request.url).searchParams.get('reservationCode')?.trim()

  if (!reservationCode) {
    return errorResponse(
      'reservation_code_required',
      'Enter a reservation code to find seats together.',
      400,
    )
  }

  const reservation = await getReservationByCode(reservationCode)
  if (!reservation || reservation.flight.id !== flightId) {
    return errorResponse(
      'reservation_not_found',
      'We cannot find that booking for this flight.',
      404,
    )
  }

  const passengerIds = reservation.passengers.map((passenger) => passenger.id)
  const blocks = await findSeatsForParty(flightId, passengerIds)

  return NextResponse.json({
    flightId,
    reservationCode: reservation.code,
    partySize: passengerIds.length,
    blocks,
  })
}

export async function POST(request: Request, context: RouteContext) {
  const { flightId } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('invalid_json', 'Send a valid JSON request body.', 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse('invalid_request', 'Choose a block of seats for the party.', 400)
  }

  const payload = body as Record<string, unknown>
  const reservationCode =
    typeof payload.reservationCode === 'string' ? payload.reservationCode.trim() : ''
  const seatIds = Array.isArray(payload.seatIds)
    ? payload.seatIds.filter((seatId): seatId is string => typeof seatId === 'string')
    : null

  if (!reservationCode) {
    return errorResponse(
      'reservation_code_required',
      'Enter a reservation code to select seats together.',
      400,
    )
  }

  if (
    !seatIds ||
    seatIds.length === 0 ||
    seatIds.length !== (payload.seatIds as unknown[]).length
  ) {
    return errorResponse(
      'seat_ids_required',
      'Choose one seat for every passenger in the party.',
      400,
    )
  }

  const reservation = await getReservationByCode(reservationCode)
  if (!reservation || reservation.flight.id !== flightId) {
    return errorResponse(
      'reservation_not_found',
      'We cannot find that booking for this flight.',
      404,
    )
  }

  const result = await assignSeatsForParty(reservation.code, seatIds)
  if (!result.ok) {
    return errorResponse(
      result.reason,
      result.message,
      assignmentFailureStatus(result.reason),
    )
  }

  return NextResponse.json(result)
}
