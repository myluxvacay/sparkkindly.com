// The result of the last admin action, carried in the URL by /admin/act/'s redirect. Rendered as text (React escapes
// it) and cut to 200 characters, so a crafted link can at most show a short line of plain text.
export default function StatusNote({ done, error }: { done?: string; error?: string }) {
  if (error) {
    return (
      <div role="alert" className="grown-ups">
        <p>{error.slice(0, 200)}</p>
      </div>
    );
  }
  if (done) {
    return (
      <div role="status" className="takeaway">
        <p>{done.slice(0, 200)}</p>
      </div>
    );
  }
  return null;
}
