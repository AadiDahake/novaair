import type { Seat } from './types'

/**
 * The accessible name of a seat button.
 *
 * These strings are a contract. A screen reader reads them, and the Patchlet widget finds controls
 * by accessible name, so the wording must stay stable. The price is spoken as words because a
 * screen reader reads "$39" poorly.
 *
 *   Seat 21A, available, no extra cost
 *   Seat 2A, available, 45 dollars
 *   Seat 12B, booked
 *   Seat 16C, exit row, adults only, 39 dollars
 *   Seat 15A, exit row, adults only, booked
 *   Seat 20D, blocked for accessibility
 *   Seat 12A, chosen for Aadi
 *
 * An exit-row seat that is free does not repeat the word "available". The exit-row wording plus a
 * price already says the seat can be taken, and this is the form the demo is written against.
 */
export function seatAriaLabel(seat: Seat, occupantFirstName?: string | null): string {
  const parts: string[] = [`Seat ${seat.id}`]
  if (seat.isExitRow) parts.push('exit row', 'adults only')

  switch (seat.state) {
    case 'booked':
      parts.push('booked')
      break
    case 'blocked':
      parts.push('blocked for accessibility')
      break
    case 'occupied':
      parts.push(occupantFirstName ? `chosen for ${occupantFirstName}` : 'chosen')
      break
    case 'available':
      if (!seat.isExitRow) parts.push('available')
      parts.push(priceWords(seat.priceCents))
      break
  }
  return parts.join(', ')
}

function priceWords(priceCents: number): string {
  if (priceCents <= 0) return 'no extra cost'
  const dollars = priceCents / 100
  return `${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)} dollars`
}

/** "$39" for a badge, or an empty string when the seat costs nothing extra. */
export function priceTag(priceCents: number): string {
  if (priceCents <= 0) return ''
  const dollars = priceCents / 100
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
