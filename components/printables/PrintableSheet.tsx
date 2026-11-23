// The sheet itself: the delivered printable, exactly as it comes off the printer. The library
// arrived as finished, branded one-page PDFs (owner's delivery, 22 Nov 2026) — SparkKindly Kids
// header, activity and footer already on the page — so the sheet view is the rendered first page
// of the item's own PDF, framed as a piece of paper. The page's print stylesheet lifts this
// element out on its own; the Download PDF button serves the original vector PDF for the
// crispest print.

type SheetImage = { src: string; alt: string; width?: number; height?: number };

export default function PrintableSheet({ title, image }: { title: string; image: SheetImage }) {
  return (
    <section className="printable-sheet" aria-label={`The printable sheet: ${title}`}>
      <img className="sheet-img" src={image.src} alt={image.alt} width={image.width} height={image.height} />
    </section>
  );
}
