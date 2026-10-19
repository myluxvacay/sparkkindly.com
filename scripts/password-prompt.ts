/** Read a CLI secret without echoing it, putting it in argv, or saving it. */
export function readPassword(label: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) throw new Error('Run this command in an interactive terminal to enter the database password.');
  const previousRaw = input.isRaw;
  process.stderr.write(label);
  return new Promise((resolve, reject) => {
    let value = '';
    function cleanup() {
      input.removeListener('data', onData);
      input.removeListener('error', onError);
      input.setRawMode(previousRaw);
      input.pause();
      process.stderr.write('\n');
    }
    function onError(error: Error) { cleanup(); reject(error); }
    function onData(chunk: Buffer | string) {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') {
          cleanup();
          if (!value) reject(new Error('Empty password.')); else resolve(value);
          return;
        }
        if (char === '\u0003' || char === '\u0004') { onError(new Error('Password entry cancelled.')); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char.charCodeAt(0) >= 32 && value.length < 4096) value += char;
      }
    }
    input.setRawMode(true);
    input.on('data', onData);
    input.on('error', onError);
    input.resume();
  });
}
