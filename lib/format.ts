const AIRPORTS: Record<string, string> = {
  SFO: 'San Francisco',
  JFK: 'New York',
  ORD: 'Chicago',
  SEA: 'Seattle',
  AUS: 'Austin',
  DEN: 'Denver',
  MIA: 'Miami',
  BOS: 'Boston',
}

export function cityForCode(code: string): string {
  return AIRPORTS[code.toUpperCase()] ?? code.toUpperCase()
}

/** "Saturday, 19 September 2026". Fixed to UTC so the server and the browser agree. */
export function formatLongDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return isoDate
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/** "19 Sep 2026". */
export function formatShortDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return isoDate
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/**
 * A passenger's name for the screen. A passenger with no last name prints as one word, so the
 * layout never shows a hanging space.
 */
export function passengerFullName(passenger: { firstName: string; lastName: string }): string {
  return [passenger.firstName, passenger.lastName].filter(Boolean).join(' ')
}

/** The initials for an avatar. One letter when the passenger has one name. */
export function passengerInitials(passenger: { firstName: string; lastName: string }): string {
  return `${passenger.firstName.slice(0, 1)}${passenger.lastName.slice(0, 1)}`
}

/** "5h 32m". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${hours}h ${String(rest).padStart(2, '0')}m`
}
