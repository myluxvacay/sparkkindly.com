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
};

export const topicChildren: Record<string, Record<string, string>> = {
  science: { physics: 'Physics', chemistry: 'Chemistry', space: 'Space', 'earth-science': 'Earth science', 'human-body': 'The human body' },
  nature: { animals: 'Animals', plants: 'Plants', oceans: 'Oceans', weather: 'Weather' },
  'maths-and-logic': { 'number-puzzles': 'Number puzzles', patterns: 'Patterns', 'logic-puzzles': 'Logic puzzles', probability: 'Probability' },
  relationships: { friendship: 'Friendship', communication: 'Communication', couples: 'Couples', empathy: 'Empathy' },
  family: { parenting: 'Parenting', 'family-activities': 'Family activities', traditions: 'Traditions' },
  motivation: { goals: 'Goals', habits: 'Habits', resilience: 'Resilience', focus: 'Focus' },
  'money-habits': { saving: 'Saving', 'spending-wisely': 'Spending wisely' },
  wellbeing: { mindfulness: 'Mindfulness', sleep: 'Sleep', stress: 'Stress' },
  creativity: { art: 'Art', music: 'Music', writing: 'Writing' },
  language: { words: 'Words', etymology: 'Where words come from' },
  history: { 'ancient-history': 'Ancient history', inventions: 'Inventions' },
  technology: { computing: 'Computing', 'internet-safety': 'Internet safety' },
  kindness: { gratitude: 'Gratitude', 'helping-others': 'Helping others' },
  'play-and-games': { 'word-games': 'Word games', 'brain-teasers': 'Brain teasers' },
};

// Top-level topics with no parent.
export const topicRoots: Record<string, string> = { curiosity: 'Curiosity' };
