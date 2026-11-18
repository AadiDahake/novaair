import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * NovaAir supports dark and light appearances through the same semantic color tokens.
 *
 * This test reads both real palettes from `app/globals.css`, so it cannot drift from the colors
 * the site ships. It measures the text, controls, focus treatment and seat-state pairs that appear
 * on screen in either appearance.
 *
 * Thresholds, from WCAG 2.1:
 *   4.5:1  text below 18.66px bold or 24px normal
 *   3:1    large text, and the edge of a control a customer can operate
 */

const AA_TEXT = 4.5
const AA_LARGE = 3

type PaletteName = 'dark' | 'light'
type Palette = Record<string, string>

function declarationBlock(css: string, marker: string): string {
  const markerStart = css.indexOf(marker)
  expect(markerStart, `missing ${marker} in app/globals.css`).toBeGreaterThanOrEqual(0)

  const blockStart = css.indexOf('{', markerStart)
  expect(blockStart, `missing declaration block for ${marker}`).toBeGreaterThanOrEqual(0)

  let depth = 0
  for (let index = blockStart; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
    if (depth === 0) return css.slice(blockStart + 1, index)
  }

  throw new Error(`unterminated declaration block for ${marker}`)
}

function parseColors(block: string): Palette {
  const colors: Palette = {}
  for (const [, name, value] of block.matchAll(
    /--color-([a-z-]+):\s*(#[0-9a-fA-F]{6}|transparent);/g,
  )) {
    if (name && value) colors[name] = value
  }
  return colors
}

async function themePalettes(): Promise<Record<PaletteName, Palette>> {
  const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8')
  const dark = parseColors(declarationBlock(css, '@theme'))
  const lightOverrides = parseColors(declarationBlock(css, 'html[data-theme="light"]'))

  return {
    dark,
    light: { ...dark, ...lightOverrides },
  }
}

/** The sRGB relative luminance of a `#rrggbb` color, per WCAG 2.1. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
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

  // Controls and their interactive states.
  { what: 'filled action text', fg: 'action-text', bg: 'blue' },
  { what: 'hovered filled action text', fg: 'action-text', bg: 'blue-dark' },
  { what: 'disabled action text', fg: 'ink-muted', bg: 'action-disabled' },
  { what: 'light action text', fg: 'ink-inverse', bg: 'pill' },
  { what: 'hovered light action text', fg: 'ink-inverse', bg: 'pill-hover' },
  { what: 'outline action text', fg: 'ink', bg: 'control-wash' },
  { what: 'hovered outline action text', fg: 'ink', bg: 'control-wash-hover' },
  { what: 'appearance selector text', fg: 'ink', bg: 'control-wash' },
  { what: 'selected text', fg: 'action-text', bg: 'blue' },

  // Seat states. Every seat prints its own id, so every state is text on a fill.
  { what: 'an available seat id', fg: 'ink', bg: 'surface-raised' },
  { what: 'a booked seat id', fg: 'ink-muted', bg: 'seat-booked' },
  { what: 'a blocked seat id, on the raised hatch stripe', fg: 'ink-muted', bg: 'seat-blocked' },
  { what: 'a blocked seat id, on the sunk hatch stripe', fg: 'ink-muted', bg: 'seat-blocked-low' },
  { what: 'a paid-seat price tag', fg: 'ink-inverse', bg: 'orange' },
]

/** A control edge or focus indicator has to be seen before the control can be used. */
const EDGE_PAIRS: { what: string; fg: string; bg: string }[] = [
  { what: 'a control edge on the shell', fg: 'line-strong', bg: 'shell' },
  { what: 'a control edge on a card', fg: 'line-strong', bg: 'surface' },
  { what: 'a control edge on a raised panel', fg: 'line-strong', bg: 'surface-raised' },
  { what: 'an input edge against its well', fg: 'line-strong', bg: 'surface-sunk' },
  { what: 'a control edge under the pointer', fg: 'line-hover', bg: 'surface' },
  { what: 'the amber outline of an available seat', fg: 'orange', bg: 'surface-raised' },
  { what: 'the amber outline against the seat panel behind it', fg: 'orange', bg: 'surface' },
  { what: 'the fill of a selected seat', fg: 'blue', bg: 'surface' },
  { what: 'the focus ring on the shell', fg: 'blue-soft', bg: 'shell' },
  { what: 'the focus ring on a card', fg: 'blue-soft', bg: 'surface' },
  { what: 'the focus ring on a raised panel', fg: 'blue-soft', bg: 'surface-raised' },
  { what: 'the focus ring around an input', fg: 'blue-soft', bg: 'surface-sunk' },
]

function colorFor(colors: Palette, token: string): string {
  const color = colors[token]
  expect(color, `unknown token --color-${token}`).toBeTypeOf('string')
  return color as string
}

describe('the appearance palettes hold WCAG AA', () => {
  it('reads the dark tokens and explicit light overrides from the stylesheet', async () => {
    const palettes = await themePalettes()

    expect(palettes.dark.ink).toBe('#f4f6ff')
    expect(palettes.dark['page-from']).toBe('#0b1020')
    expect(palettes.light.ink).toBe('#17203b')
    expect(palettes.light['page-from']).toBe('#dce4f2')
    expect(Object.keys(palettes.dark).length).toBeGreaterThan(20)
    expect(Object.keys(palettes.light).sort()).toEqual(Object.keys(palettes.dark).sort())
  })

  describe.each(['dark', 'light'] as const)('the %s palette', (paletteName) => {
    it('holds 4.5:1 for every piece of text the site paints', async () => {
      const colors = (await themePalettes())[paletteName]
      const failures: string[] = []

      for (const pair of TEXT_PAIRS) {
        const fg = colorFor(colors, pair.fg)
        const bg = colorFor(colors, pair.bg)
        const ratio = contrast(fg, bg)
        const min = pair.min ?? AA_TEXT

        if (ratio < min) {
          failures.push(
            `${pair.what}: ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, needs ${min}`,
          )
        }
      }

      expect(failures).toEqual([])
    })

    it('holds 3:1 for every control edge, focus indicator and visual state', async () => {
      const colors = (await themePalettes())[paletteName]
      const failures: string[] = []

      for (const pair of EDGE_PAIRS) {
        const fg = colorFor(colors, pair.fg)
        const bg = colorFor(colors, pair.bg)
        const ratio = contrast(fg, bg)

        if (ratio < AA_LARGE) {
          failures.push(
            `${pair.what}: ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, needs ${AA_LARGE}`,
          )
        }
      }

      expect(failures).toEqual([])
    })

    /**
     * A booked seat and a blocked seat recede on purpose, so their pad is close to the panel
     * behind them. That is only sound because the pad never carries the state on its own: the seat
     * prints its own id at 4.5:1, an available seat is ringed in amber at 3:1, and every state is
     * written out in the seat's `aria-label` and its `data-state`.
     */
    it('never leaves a seat state to the pad color alone', async () => {
      const colors = (await themePalettes())[paletteName]
      const recedingStates = ['seat-booked', 'seat-blocked', 'seat-blocked-low']

      for (const state of recedingStates) {
        const idAgainstPanel = contrast(
          colorFor(colors, 'ink-muted'),
          colorFor(colors, 'surface'),
        )
        expect(idAgainstPanel).toBeGreaterThanOrEqual(AA_TEXT)

        const idAgainstPad = contrast(
          colorFor(colors, 'ink-muted'),
          colorFor(colors, state),
        )
        expect(
          idAgainstPad,
          `ink-muted on ${state} is ${idAgainstPad.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_TEXT)
      }

      const availableRing = contrast(
        colorFor(colors, 'orange'),
        colorFor(colors, 'surface-raised'),
      )
      expect(availableRing).toBeGreaterThanOrEqual(AA_LARGE)

      const selectedSeat = contrast(
        colorFor(colors, 'blue'),
        colorFor(colors, 'surface'),
      )
      expect(selectedSeat).toBeGreaterThanOrEqual(AA_LARGE)
    })

    it('keeps the surfaces in order, darkest to lightest', async () => {
      const colors = (await themePalettes())[paletteName]
      const order = [
        'page-from',
        'page-to',
        'surface-sunk',
        'shell',
        'surface',
        'surface-raised',
      ]
      const levels = order.map((token) => luminance(colorFor(colors, token)))

      for (let index = 1; index < levels.length; index += 1) {
        expect(
          levels[index] as number,
          `--color-${order[index]} must not be darker than --color-${order[index - 1]}`,
        ).toBeGreaterThan(levels[index - 1] as number)
      }
    })
  })
})
