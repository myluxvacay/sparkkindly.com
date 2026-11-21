import { getDb } from '@/lib/db';
import { attachVideoSource, getPushVideoRow, loadOwnedPushItem, processUploadedVideo } from '@/lib/agents/content-push';
import { MAX_VIDEO_BYTES, pushMediaDir, streamToFile, videoPath } from '@/lib/agents/content-push-media';
import { agentRoute, agentLimiter, readJson } from '@/lib/agents/http';

export const dynamic = 'force-dynamic';

// POST /api/agent/content/<id>/video/
// Two bodies, one job (attach the item's video file, then upload it to YouTube, private):
// - application/json { "sourceUrl": "https://…" } — the server fetches the MP4 from that address
//   (vetted like a source), or {} to retry processing what it already has.
// - video/mp4 — the file itself, streamed to the media dir under the size cap.
// Ownership is checked before a single byte of a file body is read.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const { id } = await params;
  return agentRoute(
    request,
    async (agent) => {
      const type = request.headers.get('content-type') ?? '';
      if (type.startsWith('video/mp4')) {
        const owned = await loadOwnedPushItem(db, agent, id);
        if ('error' in owned) return owned.error;
        // Every refusal is decided BEFORE the body streams: a missing video component, a frozen item
        // or an already-uploaded video must not cost (or overwrite) a 256 MB upload first.
        if (owned.item.status !== 'draft' && owned.item.status !== 'in_review')
          return { status: 409, json: { error: 'invalid_state', message: 'Media cannot change once an item leaves draft/in_review.' } };
        const row = await getPushVideoRow(db, id);
        if (!row) return { status: 404, json: { error: 'no_video', message: 'This item has no video component; declare one in the package.' } };
        if (row.youtube_id || row.state === 'private' || row.state === 'public')
          return { status: 409, json: { error: 'invalid_state', message: 'The video is already on YouTube; its file cannot be replaced.' } };
        if (row.state === 'uploading')
          return { status: 409, json: { error: 'invalid_state', message: 'A video upload is already in progress for this item.' } };
        const dir = pushMediaDir(process.env);
        const size = await streamToFile(request.body, videoPath(dir, id), MAX_VIDEO_BYTES);
        if (size === null) return { status: 413, json: { error: 'body_too_large' } };
        if (size === 0) return { status: 422, json: { error: 'invalid_video', message: 'The upload is empty.' } };
        return processUploadedVideo(db, agent, id);
      }
      const body = await readJson(request);
      if (!body.ok) return { status: body.response.status, json: await body.response.json() };
      const value = (body.value ?? {}) as { sourceUrl?: unknown };
      if (value.sourceUrl !== undefined && typeof value.sourceUrl !== 'string')
        return { status: 422, json: { error: 'invalid_video', message: 'sourceUrl must be a string.' } };
      return attachVideoSource(db, agent, id, { sourceUrl: value.sourceUrl });
    },
    { db, limiter: agentLimiter },
  );
}
