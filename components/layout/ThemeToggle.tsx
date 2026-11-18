'use client'

import { useEffect, useRef, type ChangeEvent } from 'react'

type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'novaair-theme'

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

function applyTheme(preference: ThemePreference) {
  if (preference === 'system') {
    document.documentElement.removeAttribute('data-theme')
    return
  }

  document.documentElement.setAttribute('data-theme', preference)
}

export function ThemeToggle() {
  const selectRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    let preference: ThemePreference = 'system'

    try {
      const savedPreference = window.localStorage.getItem(STORAGE_KEY)
      if (isThemePreference(savedPreference)) {
        preference = savedPreference
      } else if (savedPreference !== null) {
        window.localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      preference = 'system'
    }

    applyTheme(preference)

    if (selectRef.current) {
      selectRef.current.value = preference
    }
  }, [])

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const preference = event.target.value as ThemePreference
    applyTheme(preference)

    try {
      if (preference === 'system') {
        window.localStorage.removeItem(STORAGE_KEY)
      } else {
        window.localStorage.setItem(STORAGE_KEY, preference)
      }
    } catch {
      // The appearance still applies for this page when storage is unavailable.
    }
  }

  return (
    <select
      ref={selectRef}
      defaultValue="system"
      onChange={handleChange}
      aria-label="Light mode"
      data-testid="light-mode-selector"
      className="rounded-full border border-line-strong bg-control-wash px-3 py-2.5 text-[0.85rem] font-semibold text-ink transition-colors hover:border-line-hover hover:bg-control-wash-hover"
    >
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  )
}
