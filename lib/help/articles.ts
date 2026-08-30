export interface HelpSection {
  heading: string
  body: string[]
}

export interface HelpArticle {
  slug: string
  title: string
  category: 'Seats' | 'Bags' | 'At the airport' | 'Your booking'
  summary: string
  sections: HelpSection[]
}

/**
 * The NovaAir help center.
 *
 * These articles describe only what the site can actually do. NovaAir can move one passenger at a
 * time or find and apply adjacent seats for a party in one atomic change.
 */
export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'how-do-i-change-my-seat',
    title: 'How do I change my seat?',
    category: 'Seats',
    summary: 'Open your trip, go to Seats, and pick seats individually or find seats together.',
    sections: [
      {
        heading: 'Change a seat online',
        body: [
          'Select My Booking in the top menu.',
          'Enter your confirmation code and the last name on the booking. Then select Find my booking.',
          'On the Manage Trip page, go to the Seats section and select Change seats.',
          'The seat map opens. To move one passenger, select the passenger in the list on the right, then select a free seat on the map.',
          'Repeat for each passenger you want to move individually.',
          'Select Confirm seats to save. Your new seats appear on the Manage Trip page.',
        ],
      },
      {
        heading: 'Find seats together',
        body: [
          'Use Find seats together when two or three passengers on your booking want adjacent seats.',
          'Choose the passengers who need to sit together, then select Find seats together.',
          'The results show consecutive seats in one row on the same side of the aisle. Options with the lowest total extra cost appear first.',
          'Select an adjacent seat option to stage one seat for each chosen passenger, then select Confirm seats.',
          'The entire group change is saved together. If any seat can no longer be assigned, no passenger in the group is moved and everyone keeps their previous seat.',
        ],
      },
      {
        heading: 'What the colours mean',
        body: [
          'A seat with an orange outline is free to take.',
          'A grey seat is already taken by another customer.',
          'A blue seat is a seat you have chosen for one of your passengers.',
          'A seat with grey hatching is held for a customer who needs accessible seating. You cannot select it.',
        ],
      },
      {
        heading: 'When you cannot change a seat',
        body: [
          'Seat changes close 60 minutes before departure.',
          'A seat that another customer has taken cannot be selected. The seat map tells you when this happens.',
          'Exit row seats are for adults only. See Traveling with children.',
        ],
      },
    ],
  },
  {
    slug: 'seat-selection-fees',
    title: 'Seat selection fees',
    category: 'Seats',
    summary: 'Standard seats cost nothing. Extra legroom seats have a fee.',
    sections: [
      {
        heading: 'Standard seats',
        body: [
          'Standard seats cost nothing extra on every NovaAir fare.',
          'The seat map shows no price tag on a standard seat, and the seat reads "no extra cost".',
        ],
      },
      {
        heading: 'Extra legroom seats',
        body: [
          'Rows 1 to 3 are bulkhead rows. They have extra legroom and cost 45 US dollars for each passenger.',
          'Rows 15 and 16 are exit rows. They have extra legroom and cost 39 US dollars for each passenger.',
          'The seat map shows the price on the seat, and the total appears in Transaction Details before you confirm.',
        ],
      },
      {
        heading: 'Refunds',
        body: [
          'A seat fee is refunded when NovaAir cancels the flight or changes your aircraft.',
          'A seat fee is not refunded when you choose to move to a different seat.',
        ],
      },
    ],
  },
  {
    slug: 'traveling-with-children',
    title: 'Traveling with children',
    category: 'Seats',
    summary: 'Find adjacent seats for your family, including an adult with a child under 13.',
    sections: [
      {
        heading: 'Seating rule',
        body: [
          'A child under 13 years of age must sit next to an adult on the same booking.',
          'Check the seat map before you travel. If your family is not seated together, use Find seats together to search for an adjacent block.',
        ],
      },
      {
        heading: 'How to find seats together',
        body: [
          'Open Manage Trip, go to Seats, and select Change seats.',
          'In Find seats together, choose two or three passengers who need adjacent seats. Include an adult when the group contains a child under 13.',
          'Select Find seats together. NovaAir shows available consecutive seats in one row on one side of the aisle, with the lowest total extra cost first.',
          'Seats A, B and C are one block. Seats D, E and F are the other block. The aisle is between C and D, so a result never crosses it.',
          'Select the adjacent seat option you want, then select Confirm seats.',
          'All passengers in the selected group move together in one change. If any assignment fails, everyone in the group keeps their previous seat.',
        ],
      },
      {
        heading: 'Exit rows',
        body: [
          'Rows 15 and 16 are exit rows. A passenger in an exit row must be an adult.',
          'A child cannot sit in an exit row. Find seats together does not offer an exit-row block for a group that includes a child.',
        ],
      },
      {
        heading: 'If your party is not seated together',
        body: [
          'If no adjacent block is available, try choosing different passengers or select seats individually on the seat map.',
          'Call NovaAir on 1-800-555-0142 and an agent will look at the seat map with you.',
          'You can also ask at the gate on the day of travel. Seats together are not guaranteed.',
        ],
      },
    ],
  },
  {
    slug: 'baggage-allowance',
    title: 'Baggage allowance',
    category: 'Bags',
    summary: 'One personal item and one carry-on bag are included. Checked bags have a fee.',
    sections: [
      {
        heading: 'Included with every fare',
        body: [
          'One personal item that fits under the seat in front of you. Maximum size 45 x 35 x 20 cm.',
          'One carry-on bag for the overhead bin. Maximum size 56 x 36 x 23 cm and maximum weight 10 kg.',
        ],
      },
      {
        heading: 'Checked bags',
        body: [
          'The first checked bag costs 35 US dollars. The second costs 45 US dollars.',
          'The maximum weight for a checked bag is 23 kg. A heavier bag costs 100 US dollars more.',
          'Add bags in the Bags section of Manage Trip, or at the airport. The airport price is higher.',
        ],
      },
      {
        heading: 'Special items',
        body: [
          'A stroller and a car seat travel free for a child on the booking.',
          'Sports equipment and musical instruments count as one checked bag.',
        ],
      },
    ],
  },
  {
    slug: 'check-in',
    title: 'Check-in',
    category: 'At the airport',
    summary: 'Check in from 24 hours before departure. Bag drop closes 45 minutes before.',
    sections: [
      {
        heading: 'When to check in',
        body: [
          'Online check-in opens 24 hours before departure and closes 60 minutes before departure.',
          'Airport check-in closes 45 minutes before departure for a domestic flight.',
        ],
      },
      {
        heading: 'How to check in',
        body: [
          'Select My Booking, find your booking, then open the Check-in section on the Manage Trip page.',
          'Confirm each passenger, then get your boarding pass.',
          'Change your seats before you check in. After check-in the seat map is read only.',
        ],
      },
      {
        heading: 'At the airport',
        body: [
          'Arrive 2 hours before a domestic departure.',
          'Bag drop closes 45 minutes before departure.',
          'Boarding closes 15 minutes before departure.',
        ],
      },
    ],
  },
  {
    slug: 'changes-and-refunds',
    title: 'Changes and refunds',
    category: 'Your booking',
    summary: 'Cancel within 24 hours for a full refund. After that a change fee may apply.',
    sections: [
      {
        heading: 'The 24 hour rule',
        body: [
          'Cancel within 24 hours of booking for a full refund, if you booked 7 days or more before departure.',
          'The refund goes back to the original form of payment in 7 business days.',
        ],
      },
      {
        heading: 'Change a flight',
        body: [
          'Nova Main and Nova Flex fares can be changed online in Manage Trip.',
          'Nova Basic fares cannot be changed.',
          'You pay any difference in fare. Nova Flex has no change fee.',
        ],
      },
      {
        heading: 'If NovaAir changes your flight',
        body: [
          'You can accept the new flight, move to another NovaAir flight on the same route, or take a full refund.',
          'Seat fees are refunded when NovaAir changes your aircraft and your seat is no longer available.',
        ],
      },
    ],
  },
]

export function getHelpArticle(slug: string): HelpArticle | null {
  return HELP_ARTICLES.find((article) => article.slug === slug) ?? null
}

export function getHelpSlugs(): string[] {
  return HELP_ARTICLES.map((article) => article.slug)
}
