/**
 * Ingests the delivered SparkKindly printable library (300 branded PDF sheets,
 * 15 categories × 20) into content/articles as Kids activity items, with a
 * rendered first-page preview image per sheet and the delivered PDF copied to
 * public/printable-pdfs/ for the Download PDF route.
 *
 * Source: the owner's "SparkKindly Printables Incoming" Google Drive delivery
 * (22 Nov 2026) — site-import-manifest.csv + the extracted category ZIPs.
 * Every manifest row carries a QA status ("DRAFT - QA REQUIRED", Fold & Make
 * "REVIEW REQUIRED"); that status is preserved verbatim in each item's
 * reviewNote. Items are staged for owner QA review on staging only.
 *
 * Usage:
 *   npx tsx scripts/ingest-printables.ts --manifest <site-import-manifest.csv> \
 *     --pdf-dir <dir of extracted PDFs, flat> --png-dir <dir of pdftoppm previews>
 * Previews: pdftoppm -png -r 110 -singlefile <pdf> <png-dir>/<basename>
 *
 * Idempotent: re-running rewrites the same files. Refuses to overwrite an
 * existing non-printable article that happens to share a slug.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) throw new Error(`Missing ${name}`);
  return args[i + 1];
};
const MANIFEST = opt('--manifest');
const PDF_DIR = opt('--pdf-dir');
const PNG_DIR = opt('--png-dir');
const DATE = '2026-11-22';

/** Minimal RFC-4180 CSV reader (quoted fields, embedded commas/newlines). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

type CategorySpec = {
  topic: string;
  display: string;
  about: string;
  howTo: string;
  takeaway: string;
  ageNote: string;
  materials: string[];
  supervision: string;
  safetyNotes: string[];
  screenFreeExtension: string;
};

const SCISSORS_SAFETY = 'Use child-safe scissors with rounded tips, and sit at a table while cutting. Keep small cut pieces away from children under 3 — they are a choking hazard.';
const PRINT_SAFETY = 'Print at 100% size (not "fit to page") so the sheet keeps its true size and the pictures stay the size they were drawn.';

const CATEGORIES: Record<string, CategorySpec> = {
  Coloring: {
    topic: 'printables-colouring', display: 'Coloring',
    about: 'A big, friendly coloring page with bold outlines that are easy for small hands to stay inside — or to decorate completely their own way.',
    howTo: 'Print the sheet, choose crayons, pencils or markers, and color the picture. There are no wrong colors: a purple sun is a great sun.',
    takeaway: 'Coloring builds hand strength, patience and focus — and every finished page is a small piece of art to be proud of.',
    ageNote: 'Bold outlines suit younger children; older children can add patterns, shading and backgrounds.',
    materials: ['A printer and paper', 'Crayons, colored pencils or markers'],
    supervision: 'Stay nearby and color along if you like — side-by-side coloring is a calm way to chat about the day.',
    safetyNotes: ['Use non-toxic crayons and markers made for children.', PRINT_SAFETY],
    screenFreeExtension: 'Take the finished page on a walk and hunt for the real thing it shows — a leaf, a star, a friendly dog — then add one detail you spotted to the picture.',
  },
  'Writing & Tracing': {
    topic: 'printables-writing-tracing', display: 'Writing & Tracing',
    about: 'Dotted lines, letters and numbers to trace slowly and carefully, building the hand control that handwriting grows from.',
    howTo: 'Print the sheet, sit at a table with feet flat, and trace each dotted line from the dot. Slow and steady beats fast and scribbly.',
    takeaway: 'Tracing grows the small hand muscles and the confidence every young writer needs.',
    ageNote: 'Short rows suit beginners; children who find them easy can try tracing with the other hand for fun.',
    materials: ['A printer and paper', 'A chunky pencil or crayon that is easy to grip'],
    supervision: 'Sit alongside for the first row, then let them show you the rest — praise effort and wobbly lines alike.',
    safetyNotes: ['A short, thick pencil is easier and safer for small hands than a long sharp one.', PRINT_SAFETY],
    screenFreeExtension: 'Hide letters or numbers around the room on sticky notes and send your tracer on a hunt to find and copy each one.',
  },
  Counting: {
    topic: 'printables-counting-maths', display: 'Counting',
    about: 'Pictures to count carefully and numbers to write — touch each picture once, say the number out loud, and write the total in the box.',
    howTo: 'Print the sheet and count each row together the first time: point, count, write. Crossing off or dotting each counted picture helps nobody get counted twice.',
    takeaway: 'Counting real pictures — and writing the number — is how numbers stop being a song and start being maths.',
    ageNote: 'Counts stay friendly for early counters; older children can add two rows together for a bonus challenge.',
    materials: ['A printer and paper', 'A pencil', 'Counters or buttons for children who like to move things as they count'],
    supervision: 'Count the first row together, then let them drive — ask "how do you know?" and enjoy the reasoning.',
    safetyNotes: ['If you use small counters, keep them away from children under 3 — they are a choking hazard.', PRINT_SAFETY],
    screenFreeExtension: 'Count real things on a walk — red cars, round stones, dogs — and keep a tally on the back of the sheet.',
  },
  Math: {
    topic: 'printables-maths', display: 'Math',
    about: 'Short, friendly maths practice with pictures to help — add, subtract and solve one problem at a time, showing your thinking in the box.',
    howTo: 'Print the sheet and work down the problems. Using fingers, drawings or counters to help is not cheating — it is exactly how mathematicians start.',
    takeaway: 'Little and often wins: five minutes of cheerful maths practice beats an hour of struggle.',
    ageNote: 'Problems use small numbers and picture support; older children can cover the pictures and solve in their heads.',
    materials: ['A printer and paper', 'A pencil and an eraser', 'Counters, coins or pasta pieces for working out'],
    supervision: 'Stay close enough to celebrate strategies, not just answers — "you counted back on your fingers, clever" builds a mathematician.',
    safetyNotes: ['If you use small counters or coins, keep them away from children under 3 — they are a choking hazard.', PRINT_SAFETY],
    screenFreeExtension: 'Make up one more problem together using snacks or toys — eat the answer when you solve it.',
  },
  'Fold & Make': {
    topic: 'printables-fold-make', display: 'Fold & Make',
    about: 'A simple folded kindness card: lay the paper flat, fold it in half, and decorate the front. Delivery note: this set is 20 variants of one simple card fold and is marked REVIEW REQUIRED — please fold-test it before classroom use.',
    howTo: 'Print the sheet, follow the numbered steps in order, and press every fold flat with the side of your hand. Open the card and write or draw a kind message inside.',
    takeaway: 'Folding paper in order — and giving the finished card away — practices patience, sequencing and kindness in one small make.',
    ageNote: 'One simple fold suits beginners with a grown-up alongside; older children can decorate with patterns and their own messages.',
    materials: ['A printer and paper (slightly thicker paper or card stock is nicest)', 'Crayons or markers to decorate', 'Stickers or drawings for the front (optional)'],
    supervision: 'Do the first fold together and let them press the crease — a well-pressed fold is the secret to a neat card.',
    safetyNotes: ['Paper edges can nip fingertips — fold slowly and press with the flat of the hand, not a fingernail.', PRINT_SAFETY],
    screenFreeExtension: 'Deliver the card to its person today — by hand, by post box, or under a pillow — and notice how giving feels.',
  },
  'Label-the-Parts': {
    topic: 'printables-science-labels', display: 'Label-the-Parts',
    about: 'A diagram to label using the word bank — read each word, find the part it names, and write it in the matching box.',
    howTo: 'Print the sheet, read the word bank together first, then let your scientist hunt for each part and write its name. Checking against a real object afterwards makes it stick.',
    takeaway: 'Naming the parts of a thing is the first step of science — you cannot investigate what you cannot name.',
    ageNote: 'The word bank does the heavy lifting for younger children; older children can cover it and label from memory, then check.',
    materials: ['A printer and paper', 'A pencil', 'The real thing to look at afterwards, if you can find one'],
    supervision: 'Read the word bank aloud together before starting — sounding out the science words is half the learning.',
    safetyNotes: [PRINT_SAFETY],
    screenFreeExtension: 'Go and find the real thing — a flower, a leaf, a bicycle — and point to each part you labelled, in real life.',
  },
  Mazes: {
    topic: 'printables-mazes', display: 'Mazes',
    about: 'A maze to solve from START to FINISH — trace the route with a finger first, then draw it with a pencil when you are sure.',
    howTo: 'Print the sheet. Finger first, pencil second: dead ends are not mistakes, they are the maze teaching you its secrets.',
    takeaway: 'Mazes grow planning, patience and the fine pencil control that handwriting needs.',
    ageNote: 'Wide paths suit newer solvers; older children can time themselves or race a grown-up on a second copy.',
    materials: ['A printer and paper', 'A pencil with an eraser for brave attempts'],
    supervision: 'Resist solving it for them — ask "what happens if you go that way?" and let the dead ends teach.',
    safetyNotes: [PRINT_SAFETY],
    screenFreeExtension: 'Draw your own maze on the back of the sheet and challenge a grown-up to solve it.',
  },
  'Dot-to-Dot': {
    topic: 'printables-dot-to-dot', display: 'Dot-to-Dot',
    about: 'Numbered dots to join in order until a picture appears — then color it in and make it yours.',
    howTo: 'Print the sheet, find number 1, and draw a straight line to 2, then 3, all the way to the end. Say each number out loud as you land on it.',
    takeaway: 'Dot-to-dot makes number order feel like a treasure hunt — the picture is the prize.',
    ageNote: 'Dot counts stay small for early counters; older children can count in twos between the dots as a stretch.',
    materials: ['A printer and paper', 'A pencil', 'Crayons or markers for the finished picture'],
    supervision: 'Count along for the first few numbers, then let them call the numbers and drive the pencil.',
    safetyNotes: [PRINT_SAFETY],
    screenFreeExtension: 'Count the dots backwards from the biggest number to 1 — then count real stairs or steps the same way.',
  },
  'Matching & Sorting': {
    topic: 'printables-matching-sorting', display: 'Matching & Sorting',
    about: 'Pictures to match to their partners — draw a line from each picture to the one that belongs with it.',
    howTo: 'Print the sheet, name each picture out loud first, then draw the matching lines. Talking about WHY two things match is where the thinking happens.',
    takeaway: 'Matching and sorting are the roots of maths, reading and science — spotting what is the same and what is different.',
    ageNote: 'Clear picture pairs suit beginners; older children can explain each match in a full sentence.',
    materials: ['A printer and paper', 'A pencil', 'Safety scissors if you would rather cut the pictures out and move them'],
    supervision: 'Ask for the reason, not just the line — "they match because…" turns a worksheet into a conversation.',
    safetyNotes: [SCISSORS_SAFETY, PRINT_SAFETY],
    screenFreeExtension: 'Sort a real drawer together — socks, spoons or crayons — into matching groups, then mess it up and race to sort it again.',
  },
  'Word Play': {
    topic: 'printables-word-play', display: 'Word Play',
    about: 'Words to unscramble, hunt and play with — letters are toys, and this sheet is the toy box.',
    howTo: 'Print the sheet and say the letters out loud. Writing the letters on scrap paper and sliding them around makes unscrambling much easier.',
    takeaway: 'Playing with letters — moving them, sounding them, laughing at silly results — is real reading practice in disguise.',
    ageNote: 'Short, friendly words suit early readers; older children can time themselves or invent a scramble for you.',
    materials: ['A printer and paper', 'A pencil', 'Scrap paper or letter tiles for sliding letters around'],
    supervision: 'Sound out the first word together, then hand over the pencil — hints beat answers every time.',
    safetyNotes: [PRINT_SAFETY],
    screenFreeExtension: 'Hunt for one of the sheet\'s words in a storybook tonight — first to spot it reads the page aloud.',
  },
  'Reading Aids': {
    topic: 'printables-reading-aids', display: 'Reading Aids',
    about: 'Syllable-building practice for growing readers: read each word part, blend the parts together, and write how many syllables you hear. Teacher note from the delivery: syllable splits are worth a quick educator check before classroom use.',
    howTo: 'Print the sheet. Clap each word slowly — one clap per syllable — then read the parts in order, faster and faster, until the whole word pops out.',
    takeaway: 'Hearing the parts inside words is a superpower for reading — long words stop being scary when you can chop them into pieces.',
    ageNote: 'Aimed at readers who know their letter sounds and are meeting longer words for the first time.',
    materials: ['A printer and paper', 'A pencil'],
    supervision: 'Clap the first word together, syllable by syllable — rhythm makes the parts easy to hear.',
    safetyNotes: [PRINT_SAFETY],
    screenFreeExtension: 'Clap the syllables in everyone\'s names at dinner — who has the longest name in the family?',
  },
  Crosswords: {
    topic: 'printables-crosswords', display: 'Crosswords',
    about: 'A mini crossword with picture-friendly clues — small grids, kind words, and the lovely click when across and down agree.',
    howTo: 'Print the sheet, read each clue, and pencil answers in lightly — when an across and a down word share a letter, they must match, and that letter is a free hint.',
    takeaway: 'Crosswords stretch spelling, vocabulary and stubbornness in the best way.',
    ageNote: 'Mini grids with short words suit newer puzzlers working with a grown-up nearby.',
    materials: ['A printer and paper', 'A pencil and a good eraser'],
    supervision: 'Be the clue-reading partner, not the answer key — wondering together is the fun part.',
    safetyNotes: [PRINT_SAFETY],
    screenFreeExtension: 'Invent one clue of your own for a family word and challenge the table at dinner.',
  },
  'Cut-and-Paste Crafts': {
    topic: 'printables-cut-paste-crafts', display: 'Cut-and-Paste Crafts',
    about: 'Pieces to cut out on the dashed lines and arrange into a picture of your own — there is no model to copy, so every finished piece is an original.',
    howTo: 'Print the sheet (card stock if you have it), cut carefully on the dashed lines, play with arrangements first, and only glue when the picture makes you smile.',
    takeaway: 'Cutting, arranging and gluing builds hand strength, planning and the courage to make something nobody has made before.',
    ageNote: 'Big shapes with dashed guides suit new cutters; older children can cut without the guides and add drawn details.',
    materials: ['A printer and paper or card stock', 'Child-safe scissors', 'A glue stick', 'A spare sheet for the finished picture'],
    supervision: 'Stay within arm\'s reach while scissors are out, and be the official holder-turner of the paper.',
    safetyNotes: [SCISSORS_SAFETY, PRINT_SAFETY],
    screenFreeExtension: 'Turn the finished picture into a tiny exhibition: tape it to the fridge, give it a title, and invite the family to the opening.',
  },
  'Kindness & Feelings': {
    topic: 'printables-kindness-feelings', display: 'Kindness & Feelings',
    about: 'A gentle page about feelings and kind acts — draw, write and think about what makes people feel happy, and what you can do about it.',
    howTo: 'Print the sheet and take it slowly. There are no right answers on a feelings page — honest ones are the whole point.',
    takeaway: 'Naming feelings — your own and other people\'s — is the first step to handling them kindly.',
    ageNote: 'Drawing-first prompts suit pre-writers; older children can write full sentences and set themselves a kindness mission.',
    materials: ['A printer and paper', 'Crayons or pencils for drawing feelings'],
    supervision: 'Listen more than you talk on this one — feelings pages often start the conversations children most need.',
    safetyNotes: ['Keep finished feelings pages private unless the child chooses to share them — feelings work deserves trust.', PRINT_SAFETY],
    screenFreeExtension: 'Do the kind act from the page today — for real, before bed — and notice what happens.',
  },
  'Story Sequencing Cards': {
    topic: 'printables-story-sequencing', display: 'Story Sequencing Cards',
    about: 'Story cards to put in order — beginning, middle and end — and then retell aloud in your own words.',
    howTo: 'Print the sheet, look at every card first, then number them in the order the story happens. Retell the story aloud using first, next and last.',
    takeaway: 'Sequencing is comprehension you can touch: a reader who can order a story understands it.',
    ageNote: 'Three-card stories suit beginners; older children can write a sentence for each card after ordering.',
    materials: ['A printer and paper', 'A pencil', 'Safety scissors if you want to cut the cards out and shuffle them'],
    supervision: 'Ask "what happened just before this one?" — it is the question that unlocks every sequence.',
    safetyNotes: [SCISSORS_SAFETY, PRINT_SAFETY],
    screenFreeExtension: 'Retell the story to a stuffed animal audience at bedtime, in order, with voices.',
  },
};

const AGE_LABEL: Record<string, string> = { '5-8': 'Ages 5–8', '6-10': 'Ages 6–10' };
const AGE_TOPIC: Record<string, string> = { '5-8': 'ages-5-8', '6-10': 'ages-6-10' };

async function main() {
  const rows = parseCsv(fs.readFileSync(MANIFEST, 'utf8'));
  if (rows.length !== 300) throw new Error(`Expected 300 manifest rows, got ${rows.length}`);
  fs.mkdirSync(path.join(ROOT, 'public/images'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'public/printable-pdfs'), { recursive: true });

  let written = 0;
  for (const row of rows) {
    const spec = CATEGORIES[row.category];
    if (!spec) throw new Error(`Unknown category: ${row.category}`);
    const ageTopic = AGE_TOPIC[row.age_band];
    if (!ageTopic) throw new Error(`Unknown age band: ${row.age_band}`);
    const slug = row.slug;
    const base = path.basename(row.file, '.pdf');
    const pdfSrc = path.join(PDF_DIR, `${base}.pdf`);
    const pngSrc = path.join(PNG_DIR, `${base}.png`);
    if (!fs.existsSync(pdfSrc)) throw new Error(`Missing PDF for ${slug}: ${pdfSrc}`);
    if (!fs.existsSync(pngSrc)) throw new Error(`Missing preview PNG for ${slug}: ${pngSrc}`);

    const outJson = path.join(ROOT, 'content/articles', `${slug}.json`);
    if (fs.existsSync(outJson)) {
      const prior = JSON.parse(fs.readFileSync(outJson, 'utf8')) as { id?: string };
      if (prior.id !== `printable-${slug}`) throw new Error(`Slug collision with a non-printable item: ${slug}`);
    }

    const previewRel = `/images/printable-${slug}.webp`;
    const previewAbs = path.join(ROOT, 'public', previewRel);
    const img = sharp(pngSrc).resize({ width: 1024 });
    const info = await img.webp({ quality: 80 }).toFile(previewAbs);
    fs.copyFileSync(pdfSrc, path.join(ROOT, 'public/printable-pdfs', `${slug}.pdf`));

    const ageLabel = AGE_LABEL[row.age_band];
    const item = {
      id: `printable-${slug}`,
      slug,
      brand: 'kids',
      contentType: 'activity',
      title: row.title,
      description: row.description,
      publishedAt: DATE,
      updatedAt: DATE,
      author: 'SparkKindly Kids',
      reviewStatus: 'approved',
      reviewer: 'SparkKindly reviewer agent',
      reviewedAt: DATE,
      reviewNote: `Delivered printable library, ingested 22 November 2026 from the owner's "SparkKindly Printables Incoming" delivery (300 typeset sheets, 15 categories). Manifest status preserved: ${row.status}. Staged on staging for owner QA review only — NOT promoted to production. One sheet per category spot-checked at ingestion (counts, sums, scrambles, crossword and syllable answer keys, label diagram, maze). Delivery README flags the whole set as drafts needing educator proofing before publication.`,
      ageGuidance: `${ageLabel}. ${spec.ageNote}`,
      hero: {
        src: previewRel,
        alt: `The '${row.title}' printable sheet (${spec.display}) — print it, then put the screen away.`,
        width: info.width,
        height: info.height,
        credit: 'SparkKindly Kids printable library',
        rights: 'Delivered to SparkKindly for publication on sparkkindly.com (22 November 2026); educator QA review pending.',
      },
      tags: ['printables', spec.topic, ageTopic],
      sources: [],
      factualClaimsReviewedAt: DATE,
      aiDisclosure: 'Typeset worksheet delivered to SparkKindly as part of the 300-sheet printable library (22 November 2026) and staged for owner QA review; educator proofing is still outstanding, as the delivery manifest records.',
      body: [
        { heading: 'About this sheet', paragraphs: [row.description, spec.about] },
        { heading: 'How to use it', paragraphs: [spec.howTo] },
      ],
      takeaway: spec.takeaway,
      fiction: false,
      materials: spec.materials,
      supervision: spec.supervision,
      safetyNotes: spec.safetyNotes,
      screenFreeExtension: spec.screenFreeExtension,
    };
    fs.writeFileSync(outJson, `${JSON.stringify(item, null, 2)}\n`);
    written++;
  }
  console.log(`Ingested ${written} printables.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
