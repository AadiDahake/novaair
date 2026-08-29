import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * NovaAir has the seat primitives but not their composition. Nothing in the product finds a group
 * of seats together or moves a party in one action. This test is the guard on that: it fails if
 * such a function, route or control appears.
 */
const ROOTS = ['lib', 'app', 'components']

const BANNED = [
  'seat_party_together',
  'seatPartyTogether',
  'findSeatsTogether',
  'find_seats_together',
  'Find seats together',
  'rankSeatGroups',
  'rank_seat_groups',
  'seatGroupsTogether',
  'Move everyone',
  'Seat us together',
]

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)))
    else if (/\.(ts|tsx|mjs|sql)$/.test(entry.name)) files.push(path)
  }
  return files
}

describe('NovaAir has no automatic group seating', () => {
  it('holds no function, route or control that seats a party together', async () => {
    const found: string[] = []
    for (const root of ROOTS) {
      for (const file of await sourceFiles(root)) {
        // This test names the phrases it bans, so it must not scan itself.
        const contents = await readFile(file, 'utf8')
        for (const phrase of BANNED) {
          if (contents.includes(phrase)) found.push(`${file}: ${phrase}`)
        }
      }
    }
    expect(found).toEqual([])
  })

  it('exports the primitives, and only the primitives', async () => {
    const primitives = await import('../lib/seats')
    const exported = Object.keys(primitives).sort()
    expect(exported).toEqual([
      'assignSeat',
      'calculateSeatPrice',
      'getAvailableSeats',
      'getPassengerRestrictions',
      'getReservation',
      'getReservationByCode',
      'getSeatMap',
    ])
  })
})
