import { CABIN_NAME, FLIGHT_ID, FLIGHT_NUMBER, RESERVATION_CODE, ROW_COUNT } from './constants'
import { DEMO_START_SEATS } from './seed'
import type { Flight, Passenger } from './types'

/**
 * The demo's fixed facts. The flight departs three weeks after the plan date of 2026-08-29.
 * Nothing here is derived at runtime, so every store and every test agrees on the same trip.
 */
export const DEMO_FLIGHT: Flight = {
  id: FLIGHT_ID,
  flightNumber: FLIGHT_NUMBER,
  originCode: 'SFO',
  originCity: 'San Francisco',
  destinationCode: 'JFK',
  destinationCity: 'New York',
  departureDate: '2026-09-19',
  departureTime: '08:15',
  arrivalTime: '16:47',
  durationMinutes: 332,
  aircraft: 'Airbus A320neo',
  cabinName: CABIN_NAME,
  rowCount: ROW_COUNT,
  fareUsd: 214,
}

/** The name a customer types to find the booking. It is the lead passenger's last name. */
export const DEMO_LAST_NAME = 'Musk'

/**
 * The party. A passenger carries their own last name, because a party does not have to share one,
 * and the third passenger has no last name at all. Anything that prints a name goes through
 * `passengerFullName` in `lib/format.ts`, so a missing last name never leaves a hanging space.
 */
export const DEMO_PASSENGERS: Passenger[] = [
  {
    id: 'PAX-1',
    reservationCode: RESERVATION_CODE,
    index: 0,
    firstName: 'Elon',
    lastName: DEMO_LAST_NAME,
    type: 'adult',
    age: 38,
    seatId: DEMO_START_SEATS[0],
  },
  {
    id: 'PAX-2',
    reservationCode: RESERVATION_CODE,
    index: 1,
    firstName: 'Sam',
    lastName: 'Altman',
    type: 'child',
    age: 9,
    seatId: DEMO_START_SEATS[1],
  },
  {
    id: 'PAX-3',
    reservationCode: RESERVATION_CODE,
    index: 2,
    firstName: 'Zuck',
    lastName: '',
    type: 'child',
    age: 6,
    seatId: DEMO_START_SEATS[2],
  },
]

export const DEMO_RESERVATION = {
  code: RESERVATION_CODE,
  lastName: DEMO_LAST_NAME,
  bookedOn: '2026-07-02',
  fareBrand: 'Nova Main',
  totalPaidUsd: 642,
}
