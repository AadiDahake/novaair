import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * NovaAir ships dark and light palettes, and contrast can quietly go wrong in either one.
 *
 * This test reads the real default tokens and light-mode overrides out of `app/globals.css`, so it
 * cannot drift from the palettes the site ships. It then measures every pair the design puts on
 * screen. A token change that drops a pair below WCAG AA fails here, with the theme and pair named.
 *
 * Thresholds, from WCAG 2.1:
 *   4.5:1  text below 18.66px bold or 24px normal
 *   3:1    large text, and the edge of a control a customer can operate
 */

const AA_TEXT = 4.5
const AA_LARGE = 3

type ThemeName = 'dark' | 'light'
type Colors = Record<string, string>

interface Palettes {
  dark: Colors
  light: Colors
  lightOverrides: Colors
}

function parseColors(source: string): Colors {
  const colors: Colors = {}

  for (const [, name, value] of source.matchAll(
    /--color-([a-z-]+):\s*(#[0-9a-fA-F]{6});/g,
  )) {
    if (name && value) colors[name] = value
  }

  return colors
}

async function themeColors(): Promise<Palettes> {
  const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8')
  const themeStart = css.indexOf('@theme')
  const lightStart = css.indexOf('html[data-theme="light"]')
  const baseStart = css.indexOf('@layer base', lightStart)

  if (themeStart < 0 || lightStart < 0 || baseStart < 0) {
    throw new Error('Could not find the default theme, light theme, or base layer in globals.css')
  }

  const dark = parseColors(css.slice(themeStart, lightStart))
  const lightOverrides = parseColors(css.slice(lightStart, baseStart))

  return {
    dark,
    light: { ...dark, ...lightOverrides },
    lightOverrides,
  }
}

function color(colors: Colors, token: string, theme: ThemeName): string {
  const value = colors[token]
  expect(value, `${theme} theme has no --color-${token} token`).toBeTypeOf('string')
  return value as string
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

describe('the dark and light palettes hold WCAG AA', () => {
  it('reads the default tokens and every light-mode override', async () => {
    const palettes = await themeColors()

    expect(palettes.dark.ink).toBe('#f4f6ff')
    expect(palettes.dark['page-from']).toBe('#0b1020')
    expect(palettes.light.ink).toBe('#17213d')
    expect(palettes.light['page-from']).toBe('#dce5f2')
    expect(Object.keys(palettes.dark).length).toBeGreaterThan(20)
    expect(Object.keys(palettes.lightOverrides).sort()).toEqual(Object.keys(palettes.dark).sort())
  })

  it('holds 4.5:1 for every piece of text each theme paints', async () => {
    const palettes = await themeColors()
    const failures: string[] = []

    for (const theme of ['dark', 'light'] as const) {
      const colors = palettes[theme]

      for (const pair of TEXT_PAIRS) {
        const fg = color(colors, pair.fg, theme)
        const bg = color(colors, pair.bg, theme)
        const ratio = contrast(fg, bg)
        const min = pair.min ?? AA_TEXT

        if (ratio < min) {
          failures.push(
            `${theme} - ${pair.what}: ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, needs ${min}`,
          )
        }
      }
    }

    expect(failures).toEqual([])
  })

  it('holds 3:1 for every control edge, focus indicator and color-carried state', async () => {
    const palettes = await themeColors()
    const failures: string[] = []

    for (const theme of ['dark', 'light'] as const) {
      const colors = palettes[theme]

      for (const pair of EDGE_PAIRS) {
        const ratio = contrast(color(colors, pair.fg, theme), color(colors, pair.bg, theme))

        if (ratio < AA_LARGE) {
          failures.push(
            `${theme} - ${pair.what}: ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, needs ${AA_LARGE}`,
          )
        }
      }
    }

    expect(failures).toEqual([])
  })

  it('holds 4.5:1 for text on filled actions in both themes', async () => {
    const palettes = await themeColors()
    const failures: string[] = []

    for (const theme of ['dark', 'light'] as const) {
      const colors = palettes[theme]

      for (const token of ['blue', 'blue-dark']) {
        const ratio = contrast('#ffffff', color(colors, token, theme))

        if (ratio < AA_TEXT) {
          failures.push(
            `${theme} - white on --color-${token} is ${ratio.toFixed(2)}:1, needs ${AA_TEXT}`,
          )
        }
      }

      // The white pill is the strongest action on the page, so its text goes the other way.
      const pill = contrast(color(colors, 'ink-inverse', theme), '#ffffff')
      if (pill < AA_TEXT) {
        failures.push(
          `${theme} - --color-ink-inverse on white is ${pill.toFixed(2)}:1, needs ${AA_TEXT}`,
        )
      }
    }

    expect(failures).toEqual([])
  })

  /**
   * A booked seat and a blocked seat recede on purpose, so their pad is close to the panel behind
   * them. That is only sound because the pad never carries the state on its own: the seat prints
   * its own id at 4.5:1, an available seat is ringed in amber at 3:1, and every state is written
   * out in the seat's `aria-label` and its `data-state`. This test holds that reasoning in place
   * for both themes.
   */
  it('never leaves a seat state to the pad color alone in either theme', async () => {
    const palettes = await themeColors()
    const failures: string[] = []

    for (const theme of ['dark', 'light'] as const) {
      const colors = palettes[theme]

      for (const state of ['seat-booked', 'seat-blocked']) {
        const idAgainstPanel = contrast(
          color(colors, 'ink-muted', theme),
          color(colors, 'surface', theme),
        )
        if (idAgainstPanel < AA_TEXT) {
          failures.push(
            `${theme} - receding seat id on the panel is ${idAgainstPanel.toFixed(2)}:1, needs ${AA_TEXT}`,
          )
        }

        const idAgainstPad = contrast(
          color(colors, 'ink-muted', theme),
          color(colors, state, theme),
        )
        if (idAgainstPad < AA_TEXT) {
          failures.push(
            `${theme} - receding seat id on ${state} is ${idAgainstPad.toFixed(2)}:1, needs ${AA_TEXT}`,
          )
        }
      }

      for (const background of ['surface-raised', 'seat-booked']) {
        const availableRing = contrast(
          color(colors, 'orange', theme),
          color(colors, background, theme),
        )
        if (availableRing < AA_LARGE) {
          failures.push(
            `${theme} - available seat ring on ${background} is ${availableRing.toFixed(2)}:1, needs ${AA_LARGE}`,
          )
        }
      }
    }

    expect(failures).toEqual([])
  })

  it('keeps the surfaces ordered from darkest to lightest in both themes', async () => {
    const palettes = await themeColors()
    const order = ['page-from', 'page-to', 'surface-sunk', 'shell', 'surface', 'surface-raised']

    for (const theme of ['dark', 'light'] as const) {
      const colors = palettes[theme]
      const levels = order.map((token) => luminance(color(colors, token, theme)))

      for (let index = 1; index < levels.length; index += 1) {
        expect(
          levels[index] as number,
          `${theme} --color-${order[index]} must not be darker than --color-${order[index - 1]}`,
        ).toBeGreaterThan(levels[index - 1] as number)
      }
    }
  })
})
