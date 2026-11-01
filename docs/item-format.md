# SparkKindly item format

What an agent submits to `POST /api/agent/items` (or through the `sparkkindly_submit_item` tool). The server validates
every field; a submission that breaks a rule is stored as a `draft` with the failing check named in its quality report,
and you can fix it and send it again. The authoritative definition is `lib/items/format.ts`.

## Rules that apply to everything

- **You never set the status.** The server decides it: a passing item is `scheduled` for the next free daily slot, a
  Kids item (audience `kids`, or a world in review mode) waits in `in_review` for the owner, a failing item stays `draft`.
- **Answers travel beside the body, never inside it.** For quizzes and games, put the correct answer in `answer`, not in `body`.
  Anything extra inside `body` is dropped.
- **`idempotencyKey`** (8 to 100 characters) makes a retry safe: the same key from the same agent returns the same item.
  Use something stable such as `<world>-<slug>`.
- **`slug`**: lowercase letters, digits and hyphens, 3 to 80 characters, unique within the world.
- **`audience`**: `kids`, `all` or `adults`. `adults` means "aimed at adults", not an age gate. Everything is family-safe.
- **`topics`**: slugs from the curated list (see the brief). An unknown topic is rejected; ask for it to be added.
- **`sources`**: `{ title, url (https only), accessedAt (YYYY-MM-DD) }`. Factual content needs at least one, and each URL
  must open.
- **`image`** is optional. Without one the site makes a branded template image. If you give one, say where it came from:
  `origin` is `template`, `stock`, `generated` or `owner-supplied`, with its `licence`.
- **`publishAt`** (ISO date-time) is optional; the server uses the next free slot if it is missing or in the past.
- **`world`** is only needed by the master agent. A world agent can only submit to its own world.

## Article

```json
{
  "kind": "article",
  "slug": "why-shadows-move",
  "title": "Why your shadow moves",
  "summary": "The quiet movement at your feet can tell you about the sky.",
  "audience": "all",
  "topics": ["space", "curiosity"],
  "sources": [{ "title": "NASA: Sundials", "url": "https://science.nasa.gov/sundials", "accessedAt": "2026-10-30" }],
  "idempotencyKey": "discover-why-shadows-move",
  "body": {
    "sections": [
      { "heading": "A moving clock", "paragraphs": ["First paragraph.", "Second paragraph."] },
      { "heading": "Try it", "paragraphs": ["Mark your shadow at noon."] }
    ],
    "takeaway": "Your shadow is a sundial you carry with you."
  }
}
```

At least two sections. Kids articles may also carry `ageGuidance`, `materials`, `supervision`, `safetyNotes`,
`screenFreeExtension` inside `body`; Kids items always wait for owner approval.

## Quiz or game

`kind` is `quiz` or `game`. Both use the same shape.

```json
{
  "kind": "quiz",
  "slug": "number-detective-031",
  "title": "Number detective",
  "summary": "What comes after 2, 6, 12, 20?",
  "audience": "all",
  "topics": ["number-puzzles"],
  "idempotencyKey": "play-number-detective-031",
  "body": {
    "mechanic": "multiple_choice",
    "prompt": "Using n × (n + 1), what comes after 2, 6, 12, 20?",
    "options": [
      { "id": "a", "text": "24" }, { "id": "b", "text": "28" },
      { "id": "c", "text": "30" }, { "id": "d", "text": "32" }
    ],
    "difficulty": "easy"
  },
  "answer": { "value": "c", "explanation": "The terms are 1×2, 2×3, 3×4 and 4×5, so the next is 5×6 = 30." }
}
```

`explanation` is required and must be at least 20 characters: say why, not only what.

| mechanic | `body` needs | `answer.value` is |
|---|---|---|
| `multiple_choice` | exactly 4 `options` with distinct ids and texts | the id of one option |
| `true_false` | nothing extra | `true` or `false` |
| `short_text` | nothing extra | `{ "accepted": ["paris", "Paris"] }` (one or more spellings) |
| `number` | nothing extra | `{ "value": 30, "tolerance": 0 }` (tolerance 0 or more) |
| `odd_one_out` | exactly 4 distinct `items` | the id of the odd one out |
| `put_in_order` | 3 to 6 distinct `items` | every item id once, in the correct order |
| `clue_reveal` | 3 to 6 `clues` | `{ "accepted": ["echo"] }` |

A mechanic that is not in this table is rejected. If you want a new kind of game (a crossword, say), say so in your run
notes; it needs code on the site first.

## Video script

```json
{
  "kind": "video_script",
  "slug": "shadow-trick-short",
  "title": "The shadow trick",
  "summary": "A 30-second short about telling the time with a stick.",
  "audience": "all",
  "idempotencyKey": "discover-shadow-trick-short",
  "body": {
    "hook": "You can tell the time with a stick.",
    "beats": [
      { "voiceover": "Push a stick into the ground.", "onScreenText": "Stick + sun", "visual": "Close-up of a stick in grass" },
      { "voiceover": "Mark the tip of its shadow.", "onScreenText": "Mark it", "visual": "Hand placing a pebble" },
      { "voiceover": "Come back in an hour.", "onScreenText": "1 hour later", "visual": "Shadow has moved" }
    ],
    "captions": "Full caption text for the post.",
    "hashtags": ["#science", "#curiosity"]
  }
}
```

At least three beats. Video scripts are stored for later; they are not shown on the site until there is a video.
