export interface FlightResult {
  id: string
  flightNumber: string
  departureTime: string
  arrivalTime: string
  durationLabel: string
  durationMinutes: number
  stops: 0 | 1 | 2
  transitLabel: string
  facilities: string[]
  priceUsd: number
  cabin: string
}

/** Static scenery. The reservation flow uses the real store; these cards are the shop window. */
export const FLIGHT_RESULTS: FlightResult[] = [
  {
    id: 'NA214',
    flightNumber: 'NA 214',
    departureTime: '08:15',
    arrivalTime: '16:47',
    durationLabel: '5h 32m',
    durationMinutes: 332,
    stops: 0,
    transitLabel: 'Direct flight, no transit',
    facilities: ['Baggage', 'Entertainment', 'USB C and Port', 'Wi-Fi Onboard'],
    priceUsd: 214,
    cabin: 'Economy Class',
  },
  {
    id: 'NA318',
    flightNumber: 'NA 318',
    departureTime: '11:40',
    arrivalTime: '20:05',
    durationLabel: '5h 25m',
    durationMinutes: 325,
    stops: 0,
    transitLabel: 'Direct flight, no transit',
    facilities: ['Baggage', 'Entertainment', 'Wi-Fi Onboard', 'Heavy Meals'],
    priceUsd: 246,
    cabin: 'Economy Class',
  },
  {
    id: 'NA502',
    flightNumber: 'NA 502',
    departureTime: '06:05',
    arrivalTime: '18:12',
    durationLabel: '9h 07m',
    durationMinutes: 547,
    stops: 1,
    transitLabel: 'Transit 1x in Denver (DEN), 1h 40m',
    facilities: ['Baggage', 'USB C and Port'],
    priceUsd: 179,
    cabin: 'Economy Class',
  },
  {
    id: 'NA744',
    flightNumber: 'NA 744',
    departureTime: '13:25',
    arrivalTime: '06:58',
    durationLabel: '10h 33m',
    durationMinutes: 633,
    stops: 1,
    transitLabel: 'Transit 1x in Chicago (ORD), 2h 05m',
    facilities: ['Baggage', 'Entertainment', 'Wi-Fi Onboard'],
    priceUsd: 168,
    cabin: 'Economy Class',
  },
  {
    id: 'NA961',
    flightNumber: 'NA 961',
    departureTime: '05:50',
    arrivalTime: '23:40',
    durationLabel: '14h 50m',
    durationMinutes: 890,
    stops: 2,
    transitLabel: 'Transit 2x in Austin (AUS) and Boston (BOS)',
    facilities: ['Baggage'],
    priceUsd: 142,
    cabin: 'Economy Class',
  },
]

export const FACILITY_OPTIONS = [
  'Baggage',
  'Entertainment',
  'USB C and Port',
  'Wi-Fi Onboard',
  'Heavy Meals',
] as const

export const STOP_OPTIONS = [
  { key: 'direct', label: 'Direct Flight', stops: 0 },
  { key: 'transit1', label: 'Transit 1x', stops: 1 },
  { key: 'transit2', label: 'Transit 2x', stops: 2 },
] as const
