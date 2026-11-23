// Release rehearsal and CI acquire identical immutable content even when a
// registry serves the manifest but rate-limits the subsequent layer download.
export { pullPinnedOfficialImage as pullRehearsalImage } from '../../../lib/image-references.mjs';
