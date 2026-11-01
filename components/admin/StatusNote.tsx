import { doneText, errorText } from '@/lib/admin/messages';

// The result of the last admin action. The URL carries only a code; the text comes from the server's own table, so a
// crafted link cannot make an admin page show text of its choosing. An unknown code shows nothing.
export default function StatusNote({ done, error }: { done?: string; error?: string }) {
  const failed = errorText(error);
  if (failed) {
    return (
      <div role="alert" className="grown-ups">
        <p>{failed}</p>
      </div>
    );
  }
  const ok = doneText(done);
  if (ok) {
    return (
      <div role="status" className="takeaway">
        <p>{ok}</p>
      </div>
    );
  }
  return null;
}
