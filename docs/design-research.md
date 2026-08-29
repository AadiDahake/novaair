# Design research: real airline sites

Date: 2026-08-29. Method: a real Chrome browser driven with `chrome-devtools-axi`, viewport 1440x900.
I read the live HTML, the accessibility tree and the page text of each site. Screenshots are in
`docs/research/`.

NovaAir is a fictional airline. It copies no text, no logo and no image from any site below.
It copies structure, control naming and interaction patterns only.

## 1. What loaded and what did not

| Site | Result | Use |
| --- | --- | --- |
| jetblue.com | Loads. Marketing pages, Manage Trips and the whole help center are open. The booking engine is behind a bot check. | Main source: manage-trip flow, help center IA, page furniture. |
| flyfrontier.com / booking.flyfrontier.com | Loads. The booking engine is open and shows the full step nav. | Source: booking step order and the position of seat selection. |
| southwest.com | Loads. | Source: home page search form layout. |
| aa.com | Loads for travel-information pages. | Source: cabin and seat vocabulary, seat pitch tables. |
| alaskaair.com | Bot check ("Client Challenge") on every path. | Not used. |
| united.com | `ERR_HTTP2_PROTOCOL_ERROR` on every path. | Not used. |
| delta.com | "Access Denied". | Not used. |

Every US carrier I tried puts the live seat map behind the booking wall: the seat step always comes
after a passenger-name form. I did not enter invented passenger data into a live airline booking
system, so I did not reach a rendered seat map. The seat map section below is therefore built from
the parts I could verify (step order, seat vocabulary, published seat rules) plus the reference
design in the NovaAir brief. This is stated plainly so nobody mistakes it for a captured DOM.

## 2. Information architecture

### JetBlue top nav
`Book`, `My Trips`, `Travel Info`, `TrueBlue`, then `Sign in` and a cart icon on the right.
Under `My Trips`: `Manage Trips`, `Manage Your Trip Help`, `Accessibility Assistance`.

The pattern to copy: a small number of top-level words, with the trip-management entry point named
after the user's object ("my trips"), not after the system ("reservation management").

NovaAir uses `Flights`, `Hotels`, `Schedule`, `Testimonials` in the centre (from the reference
design) and puts `My Booking` on the right as a filled dark pill. `My Booking` is the literal nav
text the Patchlet probe matches on.

### Find a reservation (jetblue.com/manage-trips)
See `docs/research/jetblue-manage-trips.png`.

- Breadcrumb `Home / Manage Trips`.
- `h1` "Manage trips".
- `h2` "Change or cancel flights, add bags, & more".
- Two text inputs, in this order: **Last name**, then **Confirmation code or ticket #**.
- Helper text under the code field: "ex. ABCDEF or 2790123456789".
- One primary submit button: **Continue**.

Two facts worth copying. First, the whole gate is two fields and one button, nothing else. Second,
the record locator is six letters, uppercase, and the example is shown as helper text rather than a
placeholder.

NovaAir borrows: two fields, one primary button, a six-character code, helper text with an example.
NovaAir improves on it: both inputs carry a real `<label>`. JetBlue's inputs have no `id`, no `name`,
no `aria-label` and no `placeholder`; the visible text is a sibling node. That is fragile for a
screen reader and unusable for an automated probe.

### Booking step order (Frontier)
The live step nav reads:

```
FLIGHT | INFO | BUNDLES | SEATS | BAGS | ADD-ONS | PAYMENT
```

Seat selection is its own named step, after the passengers are known and before ancillaries. It has
a dedicated landmark: `navigation "SELECT YOUR SEATS"`, disabled until the step is reachable.

NovaAir borrows the idea that seats are a first-class named step with its own URL, not a modal.

## 3. Control labels seen in the wild

| Purpose | Real label | NovaAir label |
| --- | --- | --- |
| Trip management entry | "Manage Trips" (JetBlue) | "My Booking" in the nav, "Manage Trip" as the page `h1` |
| Look up a reservation | "Continue" | "Find my booking" |
| Seat step | "SELECT YOUR SEATS" (Frontier) | "Seats" section, "Change seats" button |
| Commit the seat choice | "Continue" (both) | "Confirm seats" |
| Paid legroom product | "Main Cabin Extra" (AA), "EvenMore" (JetBlue) | "Extra legroom" |

The three names the Patchlet interface probe matches on are fixed by the brief and are literal:
**Manage Trip**, **Seats**, **Change seats**. NovaAir renders them as an `h1`, a section with that
exact accessible name, and a `<button>` with that exact accessible name.

## 4. Seat map DOM shape and interaction model

### What the real sites tell us
- AA publishes cabin tables per aircraft version with the columns `Class`, `Seat count`,
  `Seat pitch`, `Seat width`, `Wi-Fi`, `Entertainment`, `Power`. Pitch is the unit that separates a
  normal seat from a paid one: `30"` Main Cabin against `34", bulkhead, exit row` Main Cabin Extra.
  So the paid rows are the bulkhead rows and the exit rows. NovaAir uses exactly that rule: rows 1
  to 3 (bulkhead) and rows 15 and 16 (exit) are the paid extra-legroom rows.
- JetBlue's seat help page is organised as: types of seat, the paid product, extra seats, individual
  seat details, seats with limited or no recline, disability seating, then an FAQ. "Disability
  seating" being its own section is why NovaAir blocks one seat (20D) for accessibility and gives it
  a distinct visual state rather than hiding it.
- Frontier exposes the seat step as a landmark but does **not** expose its fare cells as buttons. I
  checked: the price cells are `div`s with click handlers and no role, no `tabindex` and no
  accessible name. A keyboard user cannot select a fare. NovaAir does not repeat this mistake.

### The model NovaAir implements

One passenger is selected at a time. This is the real industry model and it is also the point of the
demo: there is no way to move a party in one action.

```
select passenger  ->  click a seat  ->  that passenger now holds that seat
                                        (repeat for the next passenger)
                                              |
                                        Confirm seats
```

DOM contract, chosen so a spotlight tool and a screen reader see the same thing:

```html
<div role="group" aria-label="Row 21">
  <button type="button"
          data-seat="21A"
          data-row="21" data-column="A" data-state="available"
          aria-label="Seat 21A, available, no extra cost">21A</button>
  ...
</div>
```

- Every seat is a real `<button>`, never a `div`.
- `data-seat` carries the seat id, so a probe can find a seat without parsing text.
- `aria-label` is a sentence, not a token: `Seat 21A, available, no extra cost`,
  `Seat 12B, booked`, `Seat 16C, exit row, adults only, 39 dollars`,
  `Seat 20D, blocked for accessibility`.
- The price is spoken as words ("39 dollars") because a screen reader reads `$39` badly.
- Unavailable seats stay in the tab order and stay clickable. Clicking one produces an inline
  message that says why. A disabled button explains nothing, and a rejection is a real signal that
  the analytics contract needs.
- Rows are grouped, and the aisle is a real gap in the layout, not a margin on a seat. An algorithm
  that ignores the aisle is a trap the seed data sets deliberately.

### Legend
Real maps use three states. The reference design uses three colours: available is a white seat with
an orange outline, booked is a filled grey seat, selected is a filled blue seat. NovaAir adds two
more that the demo needs: **blocked** (hatched grey, accessibility) and **exit row** (a divider and
an "Exit row" label above the row). Paid seats carry a small price tag.

## 5. Help center

JetBlue's help center is a flat list of topic pages under `/help/<slug>`, each one an `h1` topic,
several `h2` sections and an FAQ of `h3` questions. There is a persistent "Need help?" search box in
the footer of every page.

NovaAir copies the shape: `/help` lists the articles, `/help/[slug]` renders one, each article is an
`h1` plus `h2` sections. Six articles, named for the questions a customer asks:

1. How do I change my seat?
2. Seat selection fees
3. Traveling with children
4. Baggage allowance
5. Check-in
6. Changes and refunds

"Traveling with children" states the two rules the demo depends on: a child under 13 must sit next
to an adult in the party, and seats are changed one passenger at a time. It describes no automatic
family seating feature, because none exists.

## 6. What NovaAir borrows, in one list

- Two-field reservation lookup with a six-character code and helper text.
- Seats as a named step with its own URL, reached from a "Seats" section on the trip page.
- Bulkhead and exit rows as the paid extra-legroom product.
- Exit-row age restriction, and a separate accessibility-blocked seat.
- Help center as `/help/<slug>` topic pages with `h2` sections.
- Cabin vocabulary: Economy Class, extra legroom, exit row, blocked.

## 7. What NovaAir does better than the sites I read

- Every interactive control has an accessible name, including seats and fare-style cards.
- Seat state is in `aria-label`, not in colour alone.
- Rejected seat clicks explain themselves inline instead of being silently inert.
- The reservation lookup inputs have real labels bound with `for`/`id`.
