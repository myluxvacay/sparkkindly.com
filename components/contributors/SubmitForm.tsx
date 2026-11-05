import Link from 'next/link';

// The declarations and the submit button for one saved piece. Both boxes are required (recorded with the time).
export default function SubmitForm({ id }: { id: string }) {
  return (
    <form method="post" action="/me/contribute/submit/" className="admin-form">
      <input type="hidden" name="id" value={id} />
      <p className="admin-radio">
        <input id="d-original" name="original" type="checkbox" required />
        <label htmlFor="d-original">This is my own work and contains nothing I lack the rights to.</label>
      </p>
      <p className="admin-radio">
        <input id="d-licence" name="licence" type="checkbox" required />
        <label htmlFor="d-licence">
          I keep my copyright and grant SparkKindly the licence in the <Link href="/contributors/terms/">contributor terms</Link>.
        </label>
      </p>
      <button type="submit" className="button">
        Submit for review
      </button>
    </form>
  );
}
