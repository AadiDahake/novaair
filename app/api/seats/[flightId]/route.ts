import { NextResponse } from 'next/server'
import { getSeatMap } from '../../../../lib/seats'

export const dynamic = 'force-dynamic'

/** GET /api/seats/{flightId} - the whole cabin and the state of every seat. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ flightId: string }> },
) {
  const { flightId } = await params
  const seatMap = await getSeatMap(flightId)
  if (!seatMap) {
    return NextResponse.json({ error: 'flight_not_found' }, { status: 404 })
  }
  return NextResponse.json(seatMap)
}
