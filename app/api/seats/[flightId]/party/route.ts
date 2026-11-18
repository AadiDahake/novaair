import { NextResponse } from 'next/server'
import {
  assignSeatsForParty,
  findSeatsForParty,
  getSeatMap,
} from '../../../../../lib/seats'

interface RouteContext {
  params: Promise<{ flightId: string }>
}

function getPassengerIds(request: Request): string[] {
  const searchParams = new URL(request.url).searchParams
  const values = [
    ...searchParams.getAll('passengerId'),
    ...searchParams.getAll('passengerIds'),
  ]

  return values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function failureStatus(reason: string): number {
  switch (reason) {
    case 'passenger_not_found':
    case 'seat_not_found':
      return 404
    case 'exit_row_child':
      return 422
    case 'invalid_party':
    case 'invalid_seats':
      return 400
    default:
      return 409
  }
}

export async function GET(request: Request, { params }: RouteContext) {
  const { flightId } = await params
  const seatMap = await getSeatMap(flightId)

  if (!seatMap) {
    return NextResponse.json({ error: 'flight_not_found' }, { status: 404 })
  }

  const passengerIds = getPassengerIds(request)
  if (passengerIds.length === 0) {
    return NextResponse.json(
      {
        error: 'passenger_ids_required',
        message: 'Choose the passengers who need seats together.',
      },
      { status: 400 },
    )
  }

  const options = await findSeatsForParty(flightId, passengerIds)
  return NextResponse.json({ flightId, passengerIds, options })
}

export async function POST(request: Request, { params }: RouteContext) {
  const { flightId } = await params
  const seatMap = await getSeatMap(flightId)

  if (!seatMap) {
    return NextResponse.json({ error: 'flight_not_found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'Send a valid JSON request body.' },
      { status: 400 },
    )
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      {
        error: 'passenger_ids_and_seat_ids_required',
        message: 'Choose one seat for each passenger in the party.',
      },
      { status: 400 },
    )
  }

  const payload = body as Record<string, unknown>
  if (
    !isStringArray(payload.passengerIds) ||
    !isStringArray(payload.seatIds) ||
    payload.passengerIds.length === 0 ||
    payload.passengerIds.length !== payload.seatIds.length
  ) {
    return NextResponse.json(
      {
        error: 'passenger_ids_and_seat_ids_required',
        message: 'Choose one seat for each passenger in the party.',
      },
      { status: 400 },
    )
  }

  const normalizedSeatIds = payload.seatIds.map((seatId) => seatId.trim().toUpperCase())
  const requestedSeats = [...normalizedSeatIds].sort()
  const options = await findSeatsForParty(flightId, payload.passengerIds)
  const recommendation = options.find((option) => {
    const optionSeats = [...option.seatIds].sort()
    return (
      optionSeats.length === requestedSeats.length &&
      optionSeats.every((seatId, index) => seatId === requestedSeats[index])
    )
  })

  if (!recommendation) {
    return NextResponse.json(
      {
        error: 'seats_unavailable',
        message: 'Those seats are no longer available together. Find another block and try again.',
      },
      { status: 409 },
    )
  }

  const result = await assignSeatsForParty(payload.passengerIds, normalizedSeatIds)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, message: result.message },
      { status: failureStatus(result.reason) },
    )
  }

  return NextResponse.json(result)
}
