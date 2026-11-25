import { addItem } from './tests/e2e/helpers/fixtures';
const opts = [
  { id: 'a', text: 'Alpha option' },
  { id: 'b', text: 'Bravo option' },
  { id: 'c', text: 'Charlie option' },
  { id: 'd', text: 'Delta option' },
];
const body = { mechanic: 'multiple_choice', prompt: 'A prompt that is long enough to be valid.', difficulty: 'easy', options: opts };
const a = await addItem({ world: 'play', slug: 'zz-daily-a', kind: 'quiz', title: 'ZZ Daily A', body, answer: { value: 'b', explanation: 'Bravo is right.' }, publishedAt: "now() - interval '1 minute'" });
const b = await addItem({ world: 'play', slug: 'zz-daily-b', kind: 'quiz', title: 'ZZ Daily B', body, answer: { value: 'b', explanation: 'Bravo is right.' }, topics: ['ages-3-5'], publishedAt: "now() - interval '2 minutes'" });
const c = await addItem({ world: 'play', slug: 'zz-daily-c', kind: 'quiz', title: 'ZZ Daily C', body, answer: { value: 'b', explanation: 'Bravo is right.' }, topics: ['ages-3-5'], publishedAt: "now() - interval '3 minutes'" });
console.log(JSON.stringify({ a, b, c }));
process.exit(0);
