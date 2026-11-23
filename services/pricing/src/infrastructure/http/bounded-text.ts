/**
 * Reads a response body up to `limit` bytes. Returns null when the declared or
 * actual size exceeds it, so an upstream can never exhaust this process.
 */
export async function boundedText(response: Response, limit: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > limit) return null;
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
