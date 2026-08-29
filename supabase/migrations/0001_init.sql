-- NovaAir schema.
-- One flight, its seats, one reservation, its passengers, and the seat each passenger holds.

create table if not exists flight (
  id                text primary key,
  flight_number     text        not null,
  origin_code       text        not null,
  origin_city       text        not null,
  destination_code  text        not null,
  destination_city  text        not null,
  departure_date    date        not null,
  departure_time    text        not null,
  arrival_time      text        not null,
  duration_minutes  integer     not null,
  aircraft          text        not null,
  cabin_name        text        not null,
  row_count         integer     not null,
  fare_usd          integer     not null
);

create table if not exists seat (
  flight_id         text        not null references flight (id) on delete cascade,
  id                text        not null,
  seat_row          integer     not null,
  seat_column       text        not null check (seat_column in ('A', 'B', 'C', 'D', 'E', 'F')),
  base_state        text        not null check (base_state in ('available', 'booked', 'blocked')),
  is_exit_row       boolean     not null default false,
  is_extra_legroom  boolean     not null default false,
  price_cents       integer     not null default 0,
  primary key (flight_id, id)
);

create index if not exists seat_flight_row_idx on seat (flight_id, seat_row);

create table if not exists reservation (
  code              text primary key,
  last_name         text        not null,
  flight_id         text        not null references flight (id) on delete cascade,
  booked_on         date        not null,
  fare_brand        text        not null,
  total_paid_usd    integer     not null
);

create index if not exists reservation_last_name_idx on reservation (lower(last_name));

create table if not exists passenger (
  id                text primary key,
  reservation_code  text        not null references reservation (code) on delete cascade,
  passenger_index   integer     not null,
  first_name        text        not null,
  last_name         text        not null,
  passenger_type    text        not null check (passenger_type in ('adult', 'child')),
  age               integer     not null,
  unique (reservation_code, passenger_index)
);

create table if not exists seat_assignment (
  flight_id         text        not null,
  seat_id           text        not null,
  passenger_id      text        not null references passenger (id) on delete cascade,
  assigned_at       timestamptz not null default now(),
  -- One passenger holds at most one seat on a flight.
  primary key (flight_id, passenger_id),
  -- One seat holds at most one passenger. This is what makes assignment atomic.
  unique (flight_id, seat_id),
  foreign key (flight_id, seat_id) references seat (flight_id, id) on delete cascade
);

-- Move one passenger to one seat in a single statement.
-- Returns the seat the passenger held before, or null. Raises 'seat_taken' when another passenger
-- already holds the seat. Calling it twice with the same pair changes nothing.
create or replace function assign_seat(
  p_flight_id    text,
  p_passenger_id text,
  p_seat_id      text
) returns table (previous_seat_id text)
language plpgsql
as $$
declare
  v_previous text;
  v_holder   text;
begin
  select seat_id into v_previous
    from seat_assignment
   where flight_id = p_flight_id and passenger_id = p_passenger_id
     for update;

  select passenger_id into v_holder
    from seat_assignment
   where flight_id = p_flight_id and seat_id = p_seat_id
     for update;

  if v_holder is not null and v_holder <> p_passenger_id then
    raise exception 'seat_taken' using errcode = 'unique_violation';
  end if;

  if v_previous is not distinct from p_seat_id then
    return query select v_previous;
    return;
  end if;

  delete from seat_assignment
   where flight_id = p_flight_id and passenger_id = p_passenger_id;

  insert into seat_assignment (flight_id, seat_id, passenger_id)
  values (p_flight_id, p_seat_id, p_passenger_id);

  return query select v_previous;
end;
$$;

-- The site reads and writes only through the service role on the server, so no anonymous access.
alter table flight          enable row level security;
alter table seat            enable row level security;
alter table reservation     enable row level security;
alter table passenger       enable row level security;
alter table seat_assignment enable row level security;
