import { NextResponse } from 'next/server'
import { getAvailableSeats } from '../../../../../lib/seats'

export const dynamic = 'force-dynamic'

/** GET /api/seats/{flightId}/available - the ids of every seat that can be taken right now. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ flightId: string }> },
) {
  const { flightId } = await params
  const seats = await getAvailableSeats(flightId)
  return NextResponse.json({ flightId, seats })
}
