import { NextResponse } from 'next/server'
import { assignSeat } from '../../../lib/seats'

export const dynamic = 'force-dynamic'

const STATUS_BY_REASON: Record<string, number> = {
  passenger_not_found: 404,
  seat_not_found: 404,
  seat_booked: 409,
  seat_blocked: 409,
  exit_row_child: 422,
}

/**
 * POST /api/assignments - move one passenger to one seat.
 * Body: { "passengerId": "PAX-1", "seatId": "21A" }
 *
 * One passenger for each call. There is no bulk endpoint.
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { passengerId, seatId } = (body ?? {}) as { passengerId?: unknown; seatId?: unknown }
  if (typeof passengerId !== 'string' || typeof seatId !== 'string') {
    return NextResponse.json({ error: 'passengerId_and_seatId_required' }, { status: 400 })
  }

  const result = await assignSeat(passengerId, seatId)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, message: result.message },
      { status: STATUS_BY_REASON[result.reason] ?? 400 },
    )
  }
  return NextResponse.json(result)
}
