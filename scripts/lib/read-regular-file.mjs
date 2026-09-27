import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';

/** Read a bounded regular file through one descriptor, not stat(path) then read(path).
 * O_NOFOLLOW protects the final path component on systems exposing that flag.
 * This is not a filesystem sandbox: callers still own parent-directory trust.
 */
export function readRegularFile(file, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024)
    throw new Error('INVALID_FILE_LIMIT');
  const descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile()) throw new Error('NOT_A_REGULAR_FILE');
    // Preserve symlink rejection where O_NOFOLLOW is unavailable. Inspecting
    // the pathname after opening never causes the content to be reopened.
    const named = lstatSync(file);
    if (named.isSymbolicLink() || named.dev !== opened.dev || named.ino !== opened.ino)
      throw new Error('FILE_IDENTITY_CHANGED');
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length <= maxBytes) {
      const count = readSync(descriptor, bytes, length, maxBytes + 1 - length, null);
      if (count === 0) return bytes.subarray(0, length);
      length += count;
    }
    throw new Error('FILE_LIMIT_EXCEEDED');
  } finally {
    closeSync(descriptor);
  }
}
