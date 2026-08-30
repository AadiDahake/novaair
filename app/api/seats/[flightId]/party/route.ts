import { NextResponse } from 'next/server'
import {
  assignSeatsForParty,
  findSeatsForParty,
  getReservationByCode,
} from '../../../../../lib/seats'

interface RouteContext {
  params: Promise<{ flightId: string }>
}

interface PartyRequestBody {
  reservationCode?: unknown
  seatIds?: unknown
}

function errorStatus(reason: string): number {
  switch (reason) {
    case 'flight_not_found':
    case 'passenger_not_found':
    case 'seat_not_found':
      return 404
    case 'seat_booked':
    case 'seat_blocked':
      return 409
    case 'adult_required':
    case 'exit_row_child':
    case 'seats_not_together':
      return 422
    default:
      return 400
  }
}

export async function GET(request: Request, { params }: RouteContext) {
  const { flightId } = await params
  const reservationCode = new URL(request.url).searchParams.get('reservationCode')?.trim()

  if (!reservationCode) {
    return NextResponse.json({ error: 'reservation_code_required' }, { status: 400 })
  }

  const reservation = await getReservationByCode(reservationCode)
  if (!reservation || reservation.flight.id !== flightId) {
    return NextResponse.json({ error: 'reservation_not_found' }, { status: 404 })
  }

  const options = await findSeatsForParty(flightId, reservation.code)
  return NextResponse.json({ flightId, options })
}

export async function POST(request: Request, { params }: RouteContext) {
  const { flightId } = await params
  const body = (await request.json().catch(() => null)) as PartyRequestBody | null
  const reservationCode =
    typeof body?.reservationCode === 'string' ? body.reservationCode.trim() : ''
  const rawSeatIds = body?.seatIds
  const seatIds =
    Array.isArray(rawSeatIds) &&
    rawSeatIds.every((seatId): seatId is string => typeof seatId === 'string')
      ? rawSeatIds
      : null

  if (!reservationCode || !seatIds || seatIds.length === 0) {
    return NextResponse.json(
      { error: 'reservationCode_and_seatIds_required' },
      { status: 400 },
    )
  }

  const reservation = await getReservationByCode(reservationCode)
  if (!reservation || reservation.flight.id !== flightId) {
    return NextResponse.json({ error: 'reservation_not_found' }, { status: 404 })
  }

  const result = await assignSeatsForParty(flightId, reservation.code, seatIds)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, message: result.message },
      { status: errorStatus(result.reason) },
    )
  }

  return NextResponse.json(result)
}
