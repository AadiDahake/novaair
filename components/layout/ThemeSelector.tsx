'use client'

import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'novaair-theme'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

export function ThemeSelector() {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    let selectedTheme: Theme =
      document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'

    try {
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
      if (savedTheme === 'light' || savedTheme === 'dark') {
        selectedTheme = savedTheme
      }
    } catch {
      // The document theme remains available when storage is blocked.
    }

    applyTheme(selectedTheme)
    setTheme(selectedTheme)
  }, [])

  function selectTheme(selectedTheme: Theme) {
    applyTheme(selectedTheme)
    setTheme(selectedTheme)

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, selectedTheme)
    } catch {
      // Theme selection still applies for the current page when storage is blocked.
    }
  }

  return (
    <details className="group relative">
      <summary
        aria-label="Accessibility and appearance"
        data-testid="accessibility-and-appearance"
        className="pill pill-outline cursor-pointer list-none px-4 py-2.5 text-[0.85rem] [&::-webkit-details-marker]:hidden"
      >
        Accessibility and appearance
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="h-4 w-4 transition-transform group-open:rotate-180"
          fill="none"
        >
          <path
            d="m6 8 4 4 4-4"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
        </svg>
      </summary>

      <div className="card absolute right-0 z-40 mt-2 w-64 p-4">
        <p className="text-sm font-bold text-ink">Accessibility and appearance</p>
        <p className="mt-1 text-xs text-ink-muted">Choose a light or dark color theme.</p>

        <div aria-label="Color theme" className="mt-3 grid grid-cols-2 gap-2" role="group">
          {THEMES.map((option) => {
            const isSelected = theme === option.value

            return (
              <button
                key={option.value}
                type="button"
                aria-label={`${option.label} mode`}
                aria-pressed={isSelected}
                data-testid={`${option.value}-mode`}
                onClick={() => selectTheme(option.value)}
                className={`pill px-4 py-2.5 text-sm ${
                  isSelected ? 'pill-primary' : 'pill-outline'
                }`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
    </details>
  )
}
