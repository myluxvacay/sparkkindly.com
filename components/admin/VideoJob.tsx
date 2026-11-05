import ActionForm from '@/components/admin/ActionForm';
import VideoUpload from '@/components/admin/VideoUpload';
import type { VideoJobView } from '@/lib/social/video/admin';

// The body of /admin/social/videos/<id>/ (plan 5B): the brief as plain text (React escapes it; it is agent output),
// the caption rule stated plainly, the upload forms, the validation result and checksum, the checksum-bound approval,
// the post result and errors, cancel and retry. Never a file name, folder or token.
const NAME = { tiktok: 'TikTok', youtube: 'YouTube' } as const;
const utc = (d: Date | null) => (d ? `${new Date(d).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '');
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

function Brief({ job }: { job: VideoJobView }) {
  const b = job.brief;
  if (!b) return <p>Waiting for the promotion run to write the brief.</p>;
  return (
    <dl className="admin-brief">
      <dt>Length</dt>
      <dd>{b.durationSeconds} seconds</dd>
      <dt>Narration</dt>
      <dd style={{ whiteSpace: 'pre-wrap' }}>{b.narration}</dd>
      <dt>Shots</dt>
      <dd>
        <ol>{b.shots.map((s, i) => <li key={i}>{s}</li>)}</ol>
      </dd>
      <dt>On-screen text</dt>
      <dd>
        <ul>{b.onScreenText.map((s, i) => <li key={i}>{s}</li>)}</ul>
      </dd>
      {b.captions.tiktok !== undefined && (
        <>
          <dt>TikTok caption</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{b.captions.tiktok}</dd>
        </>
      )}
      {b.captions.youtube && (
        <>
          <dt>YouTube title</dt>
          <dd>{b.captions.youtube.title}</dd>
          <dt>YouTube description</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{b.captions.youtube.description}</dd>
        </>
      )}
      <dt>Hashtags</dt>
      <dd>{b.hashtags.map((h) => `#${h}`).join(' ') || 'none'}</dd>
      {b.assets && (
        <>
          <dt>Brand assets</dt>
          <dd>
            Logo {b.assets.logo}, world colour {b.assets.worldColour}, frames {b.assets.frames.join(', ')}
          </dd>
        </>
      )}
    </dl>
  );
}

function FileState({ job }: { job: VideoJobView }) {
  const v = job.validation;
  return (
    <>
      {job.hasFile && (
        <p>
          File: {job.fileSize ? mb(job.fileSize) : ''}, SHA-256 <code>{job.fileSha256}</code>
        </p>
      )}
      {v && (
        <div role={v.ok ? undefined : 'alert'}>
          <p>{v.ok ? 'The last upload passed the checks.' : 'The last upload was refused:'}</p>
          <ul>
            {[...v.errors, ...v.warnings].map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          {v.durationSeconds !== undefined && (
            <p>
              {v.durationSeconds.toFixed(1)} seconds, {v.width} × {v.height}
            </p>
          )}
        </div>
      )}
      <p>{job.hasCaptions ? 'A caption file is attached.' : 'No caption file yet.'}</p>
    </>
  );
}

function Approve({ csrf, job, back }: { csrf: string; job: VideoJobView; back: string }) {
  const fields = { id: String(job.id), version: String(job.version), checksum: job.fileSha256 ?? '' };
  return (
    <ActionForm csrf={csrf} action="video.approve" returnTo={back} label="Approve for posting" fields={fields}>
      <p>You approve exactly the file with SHA-256 {job.fileSha256}. If it is replaced, approve again.</p>
      {job.platform === 'tiktok' && (
        <p>
          <input id="captions-burned" name="captions_burned" type="checkbox" value="yes" required />{' '}
          <label htmlFor="captions-burned">I confirm the captions are burned into this video</label>
        </p>
      )}
      <p>
        <label htmlFor="maker-note">Made by (up to 100 characters)</label>
        <input id="maker-note" name="maker_note" maxLength={100} defaultValue={job.makerNote ?? ''} />
      </p>
      <p>
        <label htmlFor="licence-note">Licence note (music, footage; up to 200 characters)</label>
        <input id="licence-note" name="licence_note" maxLength={200} defaultValue={job.licenceNote ?? ''} />
      </p>
    </ActionForm>
  );
}

function Posting({ job }: { job: VideoJobView }) {
  return (
    <>
      <p>
        Post status: <strong>{job.distributionStatus.replace('_', ' ')}</strong>
        {job.distributionStatus === 'scheduled' && job.scheduledFor && <> at {utc(job.scheduledFor)}</>}
        {job.postedAt && <>, posted {utc(job.postedAt)}</>}
      </p>
      {job.postUrl && (
        <p>
          <a href={job.postUrl}>View the post on {NAME[job.platform]}</a>
        </p>
      )}
      {job.lastError && <p className="muted">{job.lastError}</p>}
      <p className="muted">
        {job.platform === 'tiktok'
          ? 'Private until TikTok approves the app: posts made before that are visible only to the account.'
          : 'YouTube posts are private until YOUTUBE_PRIVACY is set to public in the server settings.'}
      </p>
    </>
  );
}

export default function VideoJobView({ csrf, job }: { csrf: string; job: VideoJobView }) {
  const back = `/admin/social/videos/${job.id}/`;
  const open = job.state === 'brief_ready' || job.state === 'uploaded';
  return (
    <>
      <p>
        {NAME[job.platform]} · {job.title} · job <strong>{job.state.replace('_', ' ')}</strong>
      </p>
      <p className="grown-ups">
        All video needs captions. {NAME[job.platform]}:{' '}
        {job.platform === 'youtube'
          ? 'upload a caption file (WebVTT or SRT, up to 200 KB) before approving.'
          : 'burn the captions into the video and confirm it when approving.'}
      </p>
      <section aria-labelledby="video-brief">
        <h2 id="video-brief">Brief</h2>
        <Brief job={job} />
      </section>
      <section aria-labelledby="video-file">
        <h2 id="video-file">File</h2>
        <FileState job={job} />
        {open && (
          <>
            <VideoUpload jobId={job.id} csrf={csrf} kind="video" label="Finished video (MP4, H.264, up to 256 MB)" accept="video/mp4,.mp4" />
            {job.platform === 'youtube' && <VideoUpload jobId={job.id} csrf={csrf} kind="captions" label="Caption file (WebVTT or SRT)" accept=".vtt,.srt" />}
          </>
        )}
      </section>
      {job.state === 'uploaded' && job.validation?.ok && (
        <section aria-labelledby="video-approve">
          <h2 id="video-approve">Approve</h2>
          <Approve csrf={csrf} job={job} back={back} />
        </section>
      )}
      <section aria-labelledby="video-post">
        <h2 id="video-post">Posting</h2>
        <Posting job={job} />
        <div className="admin-actions">
          {job.state === 'approved' && job.distributionStatus === 'failed' && (
            <ActionForm csrf={csrf} action="video.retry" returnTo={back} label="Retry" plain fields={{ id: String(job.id) }} />
          )}
          {job.state !== 'cancelled' && !['posting', 'posted'].includes(job.distributionStatus) && (
            <ActionForm csrf={csrf} action="video.cancel" returnTo={back} label="Cancel this job" plain fields={{ id: String(job.id) }} />
          )}
        </div>
      </section>
    </>
  );
}
