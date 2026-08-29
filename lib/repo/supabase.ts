import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Flight, Passenger, SeatColumn, SeatBaseState, SeatDefinition } from '../seats/types'
import type { AssignmentRecord, ReservationRecord, SeatRepository } from './types'

interface FlightRow {
  id: string
  flight_number: string
  origin_code: string
  origin_city: string
  destination_code: string
  destination_city: string
  departure_date: string
  departure_time: string
  arrival_time: string
  duration_minutes: number
  aircraft: string
  cabin_name: string
  row_count: number
  fare_usd: number
}

interface SeatRow {
  id: string
  seat_row: number
  seat_column: SeatColumn
  base_state: SeatBaseState
  is_exit_row: boolean
  is_extra_legroom: boolean
  price_cents: number
}

interface ReservationRow {
  code: string
  last_name: string
  flight_id: string
  booked_on: string
  fare_brand: string
  total_paid_usd: number
}

interface PassengerRow {
  id: string
  reservation_code: string
  passenger_index: number
  first_name: string
  last_name: string
  passenger_type: 'adult' | 'child'
  age: number
}

interface AssignmentRow {
  flight_id: string
  seat_id: string
  passenger_id: string
}

function toFlight(row: FlightRow): Flight {
  return {
    id: row.id,
    flightNumber: row.flight_number,
    originCode: row.origin_code,
    originCity: row.origin_city,
    destinationCode: row.destination_code,
    destinationCity: row.destination_city,
    departureDate: row.departure_date,
    departureTime: row.departure_time,
    arrivalTime: row.arrival_time,
    durationMinutes: row.duration_minutes,
    aircraft: row.aircraft,
    cabinName: row.cabin_name,
    rowCount: row.row_count,
    fareUsd: row.fare_usd,
  }
}

function toSeat(row: SeatRow): SeatDefinition {
  return {
    id: row.id,
    row: row.seat_row,
    column: row.seat_column,
    baseState: row.base_state,
    isExitRow: row.is_exit_row,
    isExtraLegroom: row.is_extra_legroom,
    priceCents: row.price_cents,
  }
}

function toReservation(row: ReservationRow): ReservationRecord {
  return {
    code: row.code,
    lastName: row.last_name,
    flightId: row.flight_id,
    bookedOn: row.booked_on,
    fareBrand: row.fare_brand,
    totalPaidUsd: row.total_paid_usd,
  }
}

export class SupabaseSeatRepository implements SeatRepository {
  readonly kind = 'supabase' as const
  private readonly client: SupabaseClient

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  async getFlight(flightId: string): Promise<Flight | null> {
    const { data } = await this.client.from('flight').select('*').eq('id', flightId).maybeSingle()
    return data ? toFlight(data as FlightRow) : null
  }

  async getSeatDefinitions(flightId: string): Promise<SeatDefinition[]> {
    const { data, error } = await this.client
      .from('seat')
      .select('id, seat_row, seat_column, base_state, is_exit_row, is_extra_legroom, price_cents')
      .eq('flight_id', flightId)
      .order('seat_row', { ascending: true })
      .order('seat_column', { ascending: true })
    if (error) throw new Error(`seat read failed: ${error.message}`)
    return (data as SeatRow[] | null)?.map(toSeat) ?? []
  }

  async getSeatDefinition(flightId: string, seatId: string): Promise<SeatDefinition | null> {
    const { data } = await this.client
      .from('seat')
      .select('id, seat_row, seat_column, base_state, is_exit_row, is_extra_legroom, price_cents')
      .eq('flight_id', flightId)
      .eq('id', seatId)
      .maybeSingle()
    return data ? toSeat(data as SeatRow) : null
  }

  async findReservation(code: string, lastName: string): Promise<ReservationRecord | null> {
    const record = await this.getReservationByCode(code)
    if (!record) return null
    if (record.lastName.toLowerCase() !== lastName.trim().toLowerCase()) return null
    return record
  }

  async getReservationByCode(code: string): Promise<ReservationRecord | null> {
    const { data } = await this.client
      .from('reservation')
      .select('*')
      .eq('code', code.trim().toUpperCase())
      .maybeSingle()
    return data ? toReservation(data as ReservationRow) : null
  }

  async getPassengers(code: string): Promise<Passenger[]> {
    const normalized = code.trim().toUpperCase()
    const { data } = await this.client
      .from('passenger')
      .select('*')
      .eq('reservation_code', normalized)
      .order('passenger_index', { ascending: true })
    const rows = (data as PassengerRow[] | null) ?? []
    if (rows.length === 0) return []

    const reservation = await this.getReservationByCode(normalized)
    const assignments = reservation ? await this.getAssignments(reservation.flightId) : []
    const seatByPassenger = new Map(assignments.map((entry) => [entry.passengerId, entry.seatId]))

    return rows.map((row) => ({
      id: row.id,
      reservationCode: row.reservation_code,
      index: row.passenger_index,
      firstName: row.first_name,
      lastName: row.last_name,
      type: row.passenger_type,
      age: row.age,
      seatId: seatByPassenger.get(row.id) ?? null,
    }))
  }

  async getPassenger(passengerId: string): Promise<Passenger | null> {
    const { data } = await this.client
      .from('passenger')
      .select('*')
      .eq('id', passengerId)
      .maybeSingle()
    if (!data) return null
    const row = data as PassengerRow
    const passengers = await this.getPassengers(row.reservation_code)
    return passengers.find((passenger) => passenger.id === passengerId) ?? null
  }

  async getAssignments(flightId: string): Promise<AssignmentRecord[]> {
    const { data } = await this.client
      .from('seat_assignment')
      .select('flight_id, seat_id, passenger_id')
      .eq('flight_id', flightId)
    return ((data as AssignmentRow[] | null) ?? []).map((row) => ({
      flightId: row.flight_id,
      seatId: row.seat_id,
      passengerId: row.passenger_id,
    }))
  }

  async assign(
    flightId: string,
    passengerId: string,
    seatId: string,
  ): Promise<{ ok: true; previousSeatId: string | null } | { ok: false; reason: 'taken' }> {
    const { data, error } = await this.client.rpc('assign_seat', {
      p_flight_id: flightId,
      p_passenger_id: passengerId,
      p_seat_id: seatId,
    })
    if (error) {
      if (error.message.includes('seat_taken')) return { ok: false, reason: 'taken' }
      throw new Error(`assign failed: ${error.message}`)
    }
    const rows = (data as { previous_seat_id: string | null }[] | null) ?? []
    return { ok: true, previousSeatId: rows[0]?.previous_seat_id ?? null }
  }

  async resetDemo(): Promise<void> {
    throw new Error('Run `npm run db:reset-demo` to reset the Supabase demo data.')
  }
}
