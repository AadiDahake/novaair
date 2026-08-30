import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * NovaAir is a dark product, and a dark product is where contrast quietly goes wrong.
 *
 * This test reads the real tokens out of the `@theme` block of `app/globals.css`, so it cannot
 * drift from the palette the site ships. It then measures every pair the design puts on screen.
 * A token change that drops a pair below WCAG AA fails here, with the pair named.
 *
 * Thresholds, from WCAG 2.1:
 *   4.5:1  text below 18.66px bold or 24px normal
 *   3:1    large text, and the edge of a control a customer can operate
 */

const AA_TEXT = 4.5
const AA_LARGE = 3

async function themeColors(): Promise<Record<string, string>> {
  const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8')
  const theme = css.slice(css.indexOf('@theme'), css.indexOf('@layer base'))
  const colors: Record<string, string> = {}
  for (const [, name, value] of theme.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6});/g)) {
    if (name && value) colors[name] = value
  }
  return colors
}

/** The sRGB relative luminance of a `#rrggbb` colour, per WCAG 2.1. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

/** Every foreground the site paints on a surface, and where. */
const TEXT_PAIRS: { what: string; fg: string; bg: string; min?: number }[] = [
  // Headings and body, on each surface in the stack.
  { what: 'heading on the page backdrop', fg: 'ink', bg: 'page-from' },
  { what: 'heading on the shell', fg: 'ink', bg: 'shell' },
  { what: 'heading on a card', fg: 'ink', bg: 'surface' },
  { what: 'heading on a raised panel', fg: 'ink', bg: 'surface-raised' },
  { what: 'panel body on a blue panel', fg: 'ink-soft', bg: 'blue-tint' },
  { what: 'panel body on a warm panel', fg: 'ink-soft', bg: 'orange-tint' },
  { what: 'secondary body on the shell', fg: 'ink-muted', bg: 'shell' },
  { what: 'secondary body on a card', fg: 'ink-muted', bg: 'surface' },
  { what: 'secondary body on a raised panel', fg: 'ink-muted', bg: 'surface-raised' },
  { what: 'field label on the shell', fg: 'ink-dim', bg: 'shell' },
  { what: 'field label on a card', fg: 'ink-dim', bg: 'surface' },
  { what: 'field label on a raised panel', fg: 'ink-dim', bg: 'surface-raised' },
  { what: 'input placeholder in its well', fg: 'ink-dim', bg: 'surface-sunk' },
  { what: 'typed input value in its well', fg: 'ink', bg: 'surface-sunk' },

  // Accents as text.
  { what: 'blue link on the shell', fg: 'blue-soft', bg: 'shell' },
  { what: 'blue link on a card', fg: 'blue-soft', bg: 'surface' },
  { what: 'blue chip text on a blue panel', fg: 'blue-soft', bg: 'blue-tint' },
  { what: 'amber label on a card', fg: 'amber-ink', bg: 'surface' },
  { what: 'amber label on a warm panel', fg: 'amber-ink', bg: 'orange-tint' },
  { what: 'a price in green on a card', fg: 'green', bg: 'surface' },
  { what: 'a price in green on a raised panel', fg: 'green', bg: 'surface-raised' },

  // Seat states. Every seat prints its own id, so every state is text on a fill.
  { what: 'an available seat id', fg: 'ink', bg: 'surface-raised' },
  { what: 'a booked seat id', fg: 'ink-muted', bg: 'seat-booked' },
  { what: 'a blocked seat id, on the raised hatch stripe', fg: 'ink-muted', bg: 'seat-blocked' },
  { what: 'a blocked seat id, on the sunk hatch stripe', fg: 'ink-muted', bg: 'seat-blocked-low' },
  { what: 'a paid-seat price tag', fg: 'ink-inverse', bg: 'orange' },
]

/** A control edge has to be seen before it can be used. */
const EDGE_PAIRS: { what: string; fg: string; bg: string }[] = [
  { what: 'a control edge on the shell', fg: 'line-strong', bg: 'shell' },
  { what: 'a control edge on a card', fg: 'line-strong', bg: 'surface' },
  { what: 'a control edge on a raised panel', fg: 'line-strong', bg: 'surface-raised' },
  { what: 'a control edge under the pointer', fg: 'line-hover', bg: 'surface' },
  { what: 'the amber outline of an available seat', fg: 'orange', bg: 'surface-raised' },
  { what: 'the fill of a selected seat', fg: 'blue', bg: 'surface' },
  { what: 'the focus ring on the shell', fg: 'blue-soft', bg: 'shell' },
  { what: 'the focus ring on a card', fg: 'blue-soft', bg: 'surface' },
  { what: 'the amber outline against the seat panel behind it', fg: 'orange', bg: 'surface' },
]

describe('the dark palette holds WCAG AA', () => {
  it('reads the tokens out of the theme block', async () => {
    const colors = await themeColors()
    expect(colors.ink).toBe('#f4f6ff')
    expect(colors['page-from']).toBe('#0b1020')
    expect(Object.keys(colors).length).toBeGreaterThan(20)
  })

  it('holds 4.5:1 for every piece of text the site paints', async () => {
    const colors = await themeColors()
    const failures: string[] = []
    for (const pair of TEXT_PAIRS) {
      const fg = colors[pair.fg]
      const bg = colors[pair.bg]
      expect(fg, `unknown token --color-${pair.fg}`).toBeTypeOf('string')
      expect(bg, `unknown token --color-${pair.bg}`).toBeTypeOf('string')
      const ratio = contrast(fg as string, bg as string)
      const min = pair.min ?? AA_TEXT
      if (ratio < min) {
        failures.push(`${pair.what}: ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, needs ${min}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('holds 3:1 for every control edge and every state a colour carries', async () => {
    const colors = await themeColors()
    const failures: string[] = []
    for (const pair of EDGE_PAIRS) {
      const ratio = contrast(colors[pair.fg] as string, colors[pair.bg] as string)
      if (ratio < AA_LARGE) {
        failures.push(
          `${pair.what}: ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, needs ${AA_LARGE}`,
        )
      }
    }
    expect(failures).toEqual([])
  })

  it('holds 4.5:1 for white text on the filled actions', async () => {
    const colors = await themeColors()
    for (const token of ['blue', 'blue-dark']) {
      const ratio = contrast('#ffffff', colors[token] as string)
      expect(ratio, `white on --color-${token} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        AA_TEXT,
      )
    }
    // The white pill is the strongest action on the page, so its text goes the other way.
    const pill = contrast(colors['ink-inverse'] as string, '#ffffff')
    expect(pill).toBeGreaterThanOrEqual(AA_TEXT)
  })

  /**
   * A booked seat and a blocked seat recede on purpose, so their pad is close to the panel behind
   * them. That is only sound because the pad never carries the state on its own: the seat prints
   * its own id at 4.5:1, an available seat is ringed in amber at 3:1, and every state is written
   * out in the seat's `aria-label` and its `data-state`. This test holds that reasoning in place.
   */
  it('never leaves a seat state to the pad colour alone', async () => {
    const colors = await themeColors()
    for (const state of ['seat-booked', 'seat-blocked']) {
      // The id on a receding seat still carries against the panel behind the seat.
      const idAgainstPanel = contrast(colors['ink-muted'] as string, colors.surface as string)
      expect(idAgainstPanel).toBeGreaterThanOrEqual(AA_TEXT)
      // And against the pad itself.
      expect(contrast(colors['ink-muted'] as string, colors[state] as string)).toBeGreaterThanOrEqual(
        AA_TEXT,
      )
    }
    // "Available" is told from "booked" by the amber ring, not by the fill, so the ring carries it.
    expect(contrast(colors.orange as string, colors['surface-raised'] as string)).toBeGreaterThanOrEqual(
      AA_LARGE,
    )
    expect(contrast(colors.orange as string, colors['seat-booked'] as string)).toBeGreaterThanOrEqual(
      AA_LARGE,
    )
  })

  it('keeps the surfaces in order, darkest to lightest', async () => {
    const colors = await themeColors()
    const order = ['page-from', 'page-to', 'surface-sunk', 'shell', 'surface', 'surface-raised']
    const levels = order.map((token) => luminance(colors[token] as string))
    for (let index = 1; index < levels.length; index += 1) {
      expect(
        levels[index] as number,
        `--color-${order[index]} must not be darker than --color-${order[index - 1]}`,
      ).toBeGreaterThan(levels[index - 1] as number)
    }
  })
})
