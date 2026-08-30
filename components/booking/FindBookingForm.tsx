'use client'

import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { ArrowRightIcon, WarningIcon } from '../ui/icons'

export function FindBookingForm() {
  const router = useRouter()
  const id = useId()
  const [code, setCode] = useState('')
  const [lastName, setLastName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const response = await fetch('/api/reservations/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, lastName }),
      })
      if (!response.ok) {
        setError('We cannot find that booking. Check the confirmation code and the last name.')
        return
      }
      const reservation = (await response.json()) as { code: string }
      router.push(`/trips/${reservation.code}`)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label className="field-label mb-1.5" htmlFor={`${id}-code`}>
          Confirmation code
        </label>
        <input
          id={`${id}-code`}
          name="code"
          className="text-input uppercase tracking-[0.14em]"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={6}
          required
          aria-describedby={`${id}-code-hint`}
        />
        <p id={`${id}-code-hint`} className="mt-1.5 text-xs text-ink-muted">
          Six letters and numbers, for example NVA7K2.
        </p>
      </div>

      <div>
        <label className="field-label mb-1.5" htmlFor={`${id}-last-name`}>
          Last name
        </label>
        <input
          id={`${id}-last-name`}
          name="lastName"
          className="text-input"
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
          autoComplete="family-name"
          required
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[14px] bg-orange-tint px-4 py-3 text-sm font-medium text-ink"
        >
          <WarningIcon className="mt-0.5 shrink-0 text-amber-ink" />
          {error}
        </p>
      ) : null}

      <button type="submit" className="pill pill-primary w-full px-7 py-3.5" disabled={busy}>
        {busy ? 'Looking...' : 'Find my booking'}
        {busy ? null : <ArrowRightIcon size={16} />}
      </button>
    </form>
  )
}
