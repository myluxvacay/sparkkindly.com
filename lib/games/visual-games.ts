// Visual picture games (owner request #21, 17 Nov 2026): image-based rounds beyond the text quizzes.
//
// Self-contained on purpose: the database play schema (lib/public/body.ts) carries text options only, so these
// rounds live in this typed file instead of forcing a schema migration. Follow-up: if picture rounds should be
// agent-authored like quizzes, extend the play body with an image reference per option and run it through
// content:validate + the reviewer pass (see docs/spark-visual-games.md).
//
// Every image is drawn in-repo as SVG (components/games/GameArt.tsx) — flags are public domain and drawn to
// their real designs; animals, fruit, landmarks are original simple illustrations. No hotlinks, no stock.
// Answers were verified against the flag/landmark/animal facts stated in each explanation.

import type { Difficulty } from '@/lib/public/body';

export type VisualGameKind = 'odd-one-out' | 'pick-the-right-one' | 'flags-and-places';

export type GameOption = {
  id: string;
  label: string;
  /** Artwork key rendered by GameArt; also the image's identity for alt text. */
  art: string;
  alt: string;
};

export type VisualRound = {
  id: string;
  kind: VisualGameKind;
  difficulty: Difficulty;
  /** Spark's spoken-style prompt for the round. */
  prompt: string;
  /** For flags-and-places rounds that lead with one big image: the artwork + its alt text. */
  hero?: { art: string; alt: string };
  options: GameOption[];
  correctId: string;
  /** Kind explanation shown after answering, whichever option was picked. */
  explanation: string;
  sparkRight: string;
  sparkTryAgain: string;
};

export const visualRounds: VisualRound[] = [
  {
    id: 'odd-fruit-car',
    kind: 'odd-one-out',
    difficulty: 'easy',
    prompt: 'One of these does not belong. Can you spot it?',
    options: [
      { id: 'apple', label: 'Apple', art: 'apple', alt: 'A red apple with a green leaf' },
      { id: 'banana', label: 'Banana', art: 'banana', alt: 'A bunch of yellow bananas' },
      { id: 'car', label: 'Car', art: 'car', alt: 'A small blue car' },
      { id: 'orange', label: 'Orange', art: 'orange', alt: 'A round orange with a leaf' },
    ],
    correctId: 'car',
    explanation: 'The apple, banana and orange are all fruits. The car is a vehicle — it is the odd one out.',
    sparkRight: 'Sharp eyes! You found the one that does not belong.',
    sparkTryAgain: 'Good try! Three of these are fruits — which one is not?',
  },
  {
    id: 'odd-flowers-mushroom',
    kind: 'odd-one-out',
    difficulty: 'easy',
    prompt: 'Three of these bloom as flowers. Which one never does?',
    options: [
      { id: 'rose', label: 'Rose', art: 'rose', alt: 'A red rose flower on a green stem' },
      { id: 'mushroom', label: 'Mushroom', art: 'mushroom', alt: 'A red toadstool mushroom with white spots' },
      { id: 'sunflower', label: 'Sunflower', art: 'sunflower', alt: 'A tall sunflower with a brown centre' },
      { id: 'tulip', label: 'Tulip', art: 'tulip', alt: 'A pink tulip flower on a green stem' },
    ],
    correctId: 'mushroom',
    explanation: 'Roses, sunflowers and tulips are flowers. A mushroom is a fungus — it grows, but it never blooms.',
    sparkRight: 'Exactly! Mushrooms are fungi, not flowers.',
    sparkTryAgain: 'Good try! Look for the one that is not a flower at all.',
  },
  {
    id: 'right-flag-japan',
    kind: 'pick-the-right-one',
    difficulty: 'easy',
    prompt: 'Which flag is Japan?',
    options: [
      { id: 'canada', label: 'Flag A', art: 'flag-ca', alt: 'A flag with a red maple leaf between two red bands on white' },
      { id: 'japan', label: 'Flag B', art: 'flag-jp', alt: 'A white flag with a single red circle in the centre' },
      { id: 'switzerland', label: 'Flag C', art: 'flag-ch', alt: 'A red square flag with a white cross in the centre' },
      { id: 'south-korea', label: 'Flag D', art: 'flag-kr', alt: 'A white flag with a red-and-blue circle in the centre and black marks in the corners' },
    ],
    correctId: 'japan',
    explanation: 'Japan’s flag is white with a single red disc in the centre, representing the sun — Japan is called the Land of the Rising Sun.',
    sparkRight: 'That is the one! The red sun disc gives it away.',
    sparkTryAgain: 'Good try! Japan’s flag is plain white with one red circle.',
  },
  {
    id: 'right-penguin',
    kind: 'pick-the-right-one',
    difficulty: 'easy',
    prompt: 'Which animal is a penguin?',
    options: [
      { id: 'owl', label: 'Owl', art: 'owl', alt: 'A brown owl with big round eyes perched upright' },
      { id: 'flamingo', label: 'Flamingo', art: 'flamingo', alt: 'A tall pink flamingo standing on one leg' },
      { id: 'duck', label: 'Duck', art: 'duck', alt: 'A yellow duck with an orange bill' },
      { id: 'penguin', label: 'Penguin', art: 'penguin', alt: 'A black-and-white penguin with an orange beak and feet' },
    ],
    correctId: 'penguin',
    explanation: 'The penguin is the black-and-white bird with a white belly, orange beak and feet. Penguins cannot fly, but they swim beautifully.',
    sparkRight: 'Yes! Black and white, and built for swimming.',
    sparkTryAgain: 'Good try! Look for the black-and-white bird that swims instead of flying.',
  },
  {
    id: 'place-eiffel',
    kind: 'flags-and-places',
    difficulty: 'easy',
    prompt: 'This famous tower stands in which country?',
    hero: { art: 'eiffel', alt: 'The Eiffel Tower, a tall iron lattice tower, against a blue sky' },
    options: [
      { id: 'italy', label: 'Italy', art: 'flag-it', alt: 'The flag of Italy: green, white and red vertical stripes' },
      { id: 'france', label: 'France', art: 'flag-fr', alt: 'The flag of France: blue, white and red vertical stripes' },
      { id: 'spain', label: 'Spain', art: 'flag-es', alt: 'The flag of Spain: red, yellow and red horizontal stripes' },
      { id: 'germany', label: 'Germany', art: 'flag-de', alt: 'The flag of Germany: black, red and gold horizontal stripes' },
    ],
    correctId: 'france',
    explanation: 'The Eiffel Tower stands in Paris, the capital of France. It was finished in 1889 for the World’s Fair.',
    sparkRight: 'Oui! The Eiffel Tower means Paris, France.',
    sparkTryAgain: 'Good try! This tower is the symbol of Paris.',
  },
  {
    id: 'place-brazil-flag',
    kind: 'flags-and-places',
    difficulty: 'medium',
    prompt: 'This flag — green, with a yellow diamond and a blue globe — belongs to which country?',
    hero: { art: 'flag-br', alt: 'The flag of Brazil: green with a yellow diamond and a blue circle with white stars' },
    options: [
      { id: 'argentina', label: 'Argentina', art: 'flag-ar', alt: 'The flag of Argentina: light blue and white horizontal stripes with a golden sun' },
      { id: 'mexico', label: 'Mexico', art: 'flag-mx', alt: 'The flag of Mexico: green, white and red vertical stripes' },
      { id: 'brazil', label: 'Brazil', art: 'flag-br', alt: 'The flag of Brazil: green with a yellow diamond and a blue circle' },
      { id: 'portugal', label: 'Portugal', art: 'flag-pt', alt: 'The flag of Portugal: green and red vertical bands with a yellow armillary sphere' },
    ],
    correctId: 'brazil',
    explanation: 'That is Brazil’s flag. The blue globe shows stars as they appeared over Rio de Janeiro on 15 November 1889.',
    sparkRight: 'Brilliant! Green and gold with a starry globe — Brazil.',
    sparkTryAgain: 'Good try! It is the largest country in South America.',
  },
  {
    id: 'place-canada-reverse',
    kind: 'flags-and-places',
    difficulty: 'medium',
    prompt: 'Reverse round: which flag belongs to Canada?',
    options: [
      { id: 'usa', label: 'Flag A', art: 'flag-us', alt: 'A flag with red and white stripes and white stars on a blue canton' },
      { id: 'uk', label: 'Flag B', art: 'flag-gb', alt: 'A blue flag with red and white crosses layered over each other' },
      { id: 'canada', label: 'Flag C', art: 'flag-ca', alt: 'A flag with a red maple leaf between two red bands on white' },
      { id: 'australia', label: 'Flag D', art: 'flag-au', alt: 'A dark blue flag with a small Union Jack in the corner and white stars' },
    ],
    correctId: 'canada',
    explanation: 'Canada’s flag has a single red maple leaf in the centre, between two red bands. It was first flown in 1965.',
    sparkRight: 'You got it! The maple leaf is Canada’s symbol.',
    sparkTryAgain: 'Good try! Look for the red maple leaf.',
  },
];

export const visualGameKinds: { kind: VisualGameKind; name: string; blurb: string }[] = [
  { kind: 'odd-one-out', name: 'Odd One Out', blurb: 'Four pictures — one does not belong.' },
  { kind: 'pick-the-right-one', name: 'Pick the Right One', blurb: 'Read the clue, pick the matching picture.' },
  { kind: 'flags-and-places', name: 'Flags & Places', blurb: 'Flags and famous places — which country?' },
];
