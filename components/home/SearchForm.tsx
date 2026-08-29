'use client'

import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { SearchIcon } from '../ui/icons'

const AIRPORTS = [
  { code: 'SFO', city: 'San Francisco' },
  { code: 'JFK', city: 'New York' },
  { code: 'ORD', city: 'Chicago' },
  { code: 'SEA', city: 'Seattle' },
  { code: 'AUS', city: 'Austin' },
  { code: 'DEN', city: 'Denver' },
  { code: 'MIA', city: 'Miami' },
  { code: 'BOS', city: 'Boston' },
]

export function SearchForm() {
  const router = useRouter()
  const id = useId()
  const [from, setFrom] = useState('SFO')
  const [to, setTo] = useState('JFK')
  const [date, setDate] = useState('2026-09-19')
  const [passengers, setPassengers] = useState('3')

  return (
    <form
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_0.8fr_auto] lg:items-end"
      onSubmit={(event) => {
        event.preventDefault()
        const query = new URLSearchParams({ from, to, date, passengers })
        router.push(`/flights?${query.toString()}`)
      }}
    >
      <div>
        <label className="field-label mb-1.5" htmlFor={`${id}-from`}>
          Departure
        </label>
        <select
          id={`${id}-from`}
          className="text-input"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        >
          {AIRPORTS.map((airport) => (
            <option key={airport.code} value={airport.code}>
              {airport.city} ({airport.code})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="field-label mb-1.5" htmlFor={`${id}-to`}>
          Arrival
        </label>
        <select
          id={`${id}-to`}
          className="text-input"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        >
          {AIRPORTS.map((airport) => (
            <option key={airport.code} value={airport.code}>
              {airport.city} ({airport.code})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="field-label mb-1.5" htmlFor={`${id}-date`}>
          Date
        </label>
        <input
          id={`${id}-date`}
          type="date"
          className="text-input"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </div>

      <div>
        <label className="field-label mb-1.5" htmlFor={`${id}-passengers`}>
          Passengers
        </label>
        <select
          id={`${id}-passengers`}
          className="text-input"
          value={passengers}
          onChange={(event) => setPassengers(event.target.value)}
        >
          {['1', '2', '3', '4', '5', '6'].map((count) => (
            <option key={count} value={count}>
              {count} {count === '1' ? 'person' : 'people'}
            </option>
          ))}
        </select>
      </div>

      <button type="submit" className="pill pill-primary h-[46px] px-7 text-[0.95rem]">
        <SearchIcon />
        Search flights
      </button>
    </form>
  )
}
