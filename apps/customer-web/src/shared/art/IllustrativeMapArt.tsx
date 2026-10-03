import { illustrativeMapMarkup } from './mapMarkup';

const OPENING_TAG = '<svg viewBox="0 0 700 500" aria-hidden="true">';
const CLOSING_TAG = '</svg>';

// The drawing's contents, without its own <svg> wrapper, so it can be placed as
// a direct child wherever the reference puts the map.
const markup = illustrativeMapMarkup.trim();
const mapContents = markup.slice(OPENING_TAG.length, markup.length - CLOSING_TAG.length);

/**
 * The approved illustrative map: a picture drawn in the page. It loads no tiles,
 * contacts no map provider and has no geographic meaning.
 */
export function IllustrativeMapArt() {
  return (
    <svg
      viewBox="0 0 700 500"
      aria-hidden="true"
      // Static, build-time markup from the approved reference; never user input.
      dangerouslySetInnerHTML={{ __html: mapContents }}
    />
  );
}
