import type { Metadata } from 'next'
import { FlightSearchView } from '../../components/flights/FlightSearchView'
import { cityForCode, formatLongDate } from '../../lib/format'

export const metadata: Metadata = { title: 'Flight Search' }

function first(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) return value[0] ?? fallback
  return value ?? fallback
}

export default async function FlightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const fromCode = first(query.from, 'SFO').toUpperCase()
  const toCode = first(query.to, 'JFK').toUpperCase()
  const date = first(query.date, '2026-09-19')
  const passengers = Number.parseInt(first(query.passengers, '3'), 10) || 1

  return (
    <FlightSearchView
      from={{ code: fromCode, city: cityForCode(fromCode) }}
      to={{ code: toCode, city: cityForCode(toCode) }}
      dateLabel={formatLongDate(date)}
      passengers={passengers}
    />
  )
}
