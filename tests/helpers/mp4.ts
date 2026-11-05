// Tiny MP4 files built in memory for the video upload tests (plan 5B): an `ftyp` box, a `moov` box holding an H.264
// (`avc1`/`avcC`) sample entry and an `mdat` box. Not playable; enough for the container checks. Never committed as a
// binary: tests write them to the OS temp directory.
const box = (type: string, payload: Buffer) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
};

export function mp4(o: { codec?: string; brand?: string; mdatBytes?: number; trailing?: Buffer } = {}): Buffer {
  const ftyp = box('ftyp', Buffer.concat([Buffer.from(o.brand ?? 'isom', 'latin1'), Buffer.alloc(4), Buffer.from('isomavc1mp41', 'latin1')]));
  const codec = o.codec ?? 'avc1';
  const entry = box(codec, Buffer.concat([Buffer.alloc(78), box(codec === 'avc1' ? 'avcC' : 'hvcC', Buffer.alloc(8))]));
  const moov = box('moov', box('trak', box('mdia', box('minf', box('stbl', box('stsd', Buffer.concat([Buffer.alloc(8), entry])))))));
  const mdat = box('mdat', Buffer.alloc(o.mdatBytes ?? 64, 7));
  return Buffer.concat([ftyp, moov, mdat, o.trailing ?? Buffer.alloc(0)]);
}

export const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nThree shapes look alike.\n\n00:00:02.000 --> 00:00:04.000\n<v Narrator>One hides a secret.\n';
export const srt = '1\n00:00:00,000 --> 00:00:02,000\nThree shapes look alike.\n\n2\n00:00:02,000 --> 00:00:04,000\nOne hides a secret.\n';

// A ReadableStream of the given chunks, optionally failing after them (an aborted upload).
export function streamOf(chunks: Buffer[], failAfter = false): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i < chunks.length) c.enqueue(new Uint8Array(chunks[i++]));
      else if (failAfter) c.error(new Error('client went away'));
      else c.close();
    },
  });
}
