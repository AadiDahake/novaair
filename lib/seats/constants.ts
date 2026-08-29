import type { SeatColumn } from './types'

/** The one flight the demo uses. */
export const FLIGHT_ID = 'NA214'
export const FLIGHT_NUMBER = 'NA 214'
export const RESERVATION_CODE = 'NVA7K2'

export const ROW_COUNT = 30
export const COLUMNS: SeatColumn[] = ['A', 'B', 'C', 'D', 'E', 'F']
export const LEFT_COLUMNS: SeatColumn[] = ['A', 'B', 'C']
export const RIGHT_COLUMNS: SeatColumn[] = ['D', 'E', 'F']
/** The aisle sits between C and D. */
export const AISLE_AFTER: SeatColumn = 'C'

/** Exit rows. Adults only, and they carry extra legroom. */
export const EXIT_ROWS = [15, 16] as const
/** Bulkhead rows. Extra legroom, no age restriction. */
export const BULKHEAD_ROWS = [1, 2, 3] as const

export const BULKHEAD_PRICE_CENTS = 4500
export const EXIT_ROW_PRICE_CENTS = 3900

/** One seat is held out of service for accessibility. */
export const BLOCKED_SEATS = ['20D'] as const

/** A passenger below this age must sit next to an adult in the same party. */
export const UNACCOMPANIED_MINIMUM_AGE = 13

export const CABIN_NAME = 'Economy Class'

export function isExitRow(row: number): boolean {
  return (EXIT_ROWS as readonly number[]).includes(row)
}

export function isBulkheadRow(row: number): boolean {
  return (BULKHEAD_ROWS as readonly number[]).includes(row)
}

export function isExtraLegroomRow(row: number): boolean {
  return isExitRow(row) || isBulkheadRow(row)
}

export function seatId(row: number, column: SeatColumn): string {
  return `${row}${column}`
}

export function parseSeatId(id: string): { row: number; column: SeatColumn } | null {
  const match = /^(\d{1,2})([A-F])$/.exec(id.trim().toUpperCase())
  if (!match) return null
  const row = Number(match[1])
  const column = match[2] as SeatColumn
  if (row < 1 || row > ROW_COUNT) return null
  if (!COLUMNS.includes(column)) return null
  return { row, column }
}
