import Breadcrumb from '@/components/Breadcrumb';

export type TrustSection = { heading: string; paragraphs: React.ReactNode[] };

type Props = { crumb: string; eyebrow: string; title: string; updated: string; sections: TrustSection[]; children?: React.ReactNode };

// The shared shell for About, Privacy, Terms, Accessibility, Contact and Editorial policy. Children, when given,
// render inside the page container after the prose sections (the Contact page's form).
export default function TrustPage({ crumb, eyebrow, title, updated, sections, children }: Props) {
  return (
    <div className="container trust-page">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: crumb }]} />
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="muted">Last updated {updated}.</p>
      <div className="prose">
        {sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            {s.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        ))}
      </div>
      {children}
    </div>
  );
}
