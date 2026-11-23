// The initial curated topic list. Owner-managed from here on (/admin); agents tag items from it and may
// propose additions, never create topics directly. Parents group children for dashboards and circle interests.
export const topicParents: Record<string, string> = {
  science: 'Science',
  nature: 'Nature',
  'maths-and-logic': 'Maths and logic',
  relationships: 'Relationships',
  family: 'Family',
  motivation: 'Motivation',
  'money-habits': 'Money habits',
  wellbeing: 'Wellbeing',
  creativity: 'Creativity',
  language: 'Language',
  history: 'History',
  technology: 'Technology',
  kindness: 'Kindness',
  'play-and-games': 'Play and games',
  green: 'Green',
};

export const topicChildren: Record<string, Record<string, string>> = {
  science: { physics: 'Physics', chemistry: 'Chemistry', space: 'Space', 'earth-science': 'Earth science', 'human-body': 'The human body' },
  nature: { animals: 'Animals', plants: 'Plants', oceans: 'Oceans', weather: 'Weather' },
  'maths-and-logic': { 'number-puzzles': 'Number puzzles', patterns: 'Patterns', 'logic-puzzles': 'Logic puzzles', probability: 'Probability' },
  relationships: { friendship: 'Friendship', communication: 'Communication', couples: 'Couples', empathy: 'Empathy' },
  family: { parenting: 'Parenting', 'family-activities': 'Family activities', traditions: 'Traditions' },
  motivation: { goals: 'Goals', habits: 'Habits', resilience: 'Resilience', focus: 'Focus' },
  'money-habits': {
    saving: 'Saving',
    'spending-wisely': 'Spending wisely',
    budgeting: 'Budgeting',
    'student-money': 'Student money',
    'money-basics': 'Money basics',
    'understanding-offers': 'Understanding offers',
  },
  wellbeing: { mindfulness: 'Mindfulness', sleep: 'Sleep', stress: 'Stress' },
  creativity: { art: 'Art', music: 'Music', writing: 'Writing' },
  language: { words: 'Words', etymology: 'Where words come from', grammar: 'Grammar', phonics: 'Phonics', vocabulary: 'Vocabulary' },
  history: { 'ancient-history': 'Ancient history', inventions: 'Inventions' },
  technology: { computing: 'Computing', 'internet-safety': 'Internet safety' },
  kindness: { gratitude: 'Gratitude', 'helping-others': 'Helping others' },
  'play-and-games': { 'word-games': 'Word games', 'brain-teasers': 'Brain teasers' },
  green: { climate: 'Climate', recycling: 'Recycling', 'reducing-waste': 'Reducing waste', 'energy-saving': 'Saving energy' },
  printables: {
    'printables-colouring': 'Coloring Pages',
    'printables-writing-tracing': 'Writing & Tracing',
    'printables-counting-maths': 'Counting',
    'printables-maths': 'Math',
    'printables-fold-make': 'Fold & Make',
    'printables-mazes': 'Mazes',
    'printables-dot-to-dot': 'Dot-to-Dot',
    'printables-matching-sorting': 'Matching & Sorting',
    'printables-word-play': 'Word Play',
    'printables-reading-aids': 'Reading Aids',
    'printables-crosswords': 'Crosswords',
    'printables-cut-paste-crafts': 'Cut-and-Paste Crafts',
    'printables-kindness-feelings': 'Kindness & Feelings',
    'printables-science-labels': 'Label-the-Parts',
    'printables-story-sequencing': 'Story Sequencing Cards',
    'printables-how-things-work': 'How Things Work',
    'ages-5-8': 'Ages 5–8',
    'ages-6-10': 'Ages 6–10',
  },
};

// Top-level topics with no parent. The reading-series structure (migration 043 mirrors it for existing
// databases): the collection, the series and its explainer track, and the three reading bands.
// Printables (22 Nov 2026): the collection root; its children in topicChildren below carry the fifteen
// printable categories and the two delivered age bands, so the hub can filter on topics alone.
export const topicRoots: Record<string, string> = {
  curiosity: 'Curiosity',
  reading: 'Reading',
  'poster-series': 'Poster series',
  explainers: 'Explainers',
  'pre-k': 'Pre-K',
  'grades-k-2': 'Grades K-2',
  'grades-3-5': 'Grades 3-5',
  printables: 'Printables',
};
