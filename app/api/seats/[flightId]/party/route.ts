import { NextResponse } from 'next/server'
import {
  assignSeatsForParty,
  findSeatsForParty,
  type AssignSeatsForPartyResult,
  type SeatPartyAssignment,
} from '../../../../../lib/seats'

interface RouteContext {
  params: Promise<{ flightId: string }>
}

function parsePassengerIds(request: Request): string[] {
  const { searchParams } = new URL(request.url)
  const values = searchParams.getAll('passengerId')
  const partyValues = searchParams.getAll('passengerIds')
  const source = values.length > 0 ? values : partyValues

  return source
    .flatMap((value) => {
      const trimmed = value.trim()
      if (trimmed.startsWith('[')) {
        try {
          const parsed: unknown = JSON.parse(trimmed)
          if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) {
            return parsed
          }
        } catch {
          return []
        }
      }
      return trimmed.split(',')
    })
    .map((passengerId) => passengerId.trim())
    .filter(Boolean)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isPartyAssignmentArray(value: unknown): value is SeatPartyAssignment[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'passengerId' in entry &&
        typeof entry.passengerId === 'string' &&
        'seatId' in entry &&
        typeof entry.seatId === 'string',
    )
  )
}

function failureStatus(reason: string): number {
  switch (reason) {
    case 'passenger_not_found':
    case 'seat_not_found':
      return 404
    case 'seats_unavailable':
    case 'seat_booked':
    case 'seat_blocked':
      return 409
    case 'exit_row_child':
      return 422
    default:
      return 400
  }
}

export async function GET(request: Request, { params }: RouteContext) {
  const { flightId } = await params
  const passengerIds = parsePassengerIds(request)

  if (passengerIds.length === 0) {
    return NextResponse.json(
      {
        error: 'passengerIds_required',
        message: 'Choose the passengers who need seats together.',
      },
      { status: 400 },
    )
  }

  const options = (await findSeatsForParty(flightId, passengerIds)).map((option) => ({
    seatIds: option.seatIds,
    row: option.row,
    extraCostCents: option.extraCostCents,
    totalPriceCents: option.totalPriceCents,
  }))

  return NextResponse.json({ flightId, options })
}

export async function POST(request: Request, { params }: RouteContext) {
  const { flightId } = await params
  const body: unknown = await request.json().catch(() => null)

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      {
        error: 'party_assignments_required',
        message: 'Choose one seat for each passenger in your party.',
      },
      { status: 400 },
    )
  }

  let result: AssignSeatsForPartyResult

  if ('assignments' in body && isPartyAssignmentArray(body.assignments)) {
    result = await assignSeatsForParty(flightId, body.assignments)
  } else if (
    'passengerIds' in body &&
    'seatIds' in body &&
    isStringArray(body.passengerIds) &&
    isStringArray(body.seatIds)
  ) {
    result = await assignSeatsForParty(flightId, body.passengerIds, body.seatIds)
  } else {
    return NextResponse.json(
      {
        error: 'party_assignments_required',
        message: 'Choose one seat for each passenger in your party.',
      },
      { status: 400 },
    )
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, message: result.message },
      { status: failureStatus(result.reason) },
    )
  }

  return NextResponse.json(result)
}
