import { referenceArtDefs, referenceCarSymbols } from './artMarkup';
import { exteriorSceneMarkup, type CarArtId } from './sceneArt';

const spriteMarkup = `<defs>${referenceArtDefs.join('')}</defs>${referenceCarSymbols.join('')}`;

/**
 * Hidden gradient/symbol sprite the car and scene artwork resolve their
 * `url(#…)` and `<use href>` references against. Mount it once per screen.
 */
export function ReferenceArtSprite() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="0"
      height="0"
      style={{ position: 'absolute', overflow: 'hidden' }}
      aria-hidden="true"
      // Static, build-time markup from the approved reference; never user input.
      dangerouslySetInnerHTML={{ __html: spriteMarkup }}
    />
  );
}

export function CarArt({ art }: { readonly art: CarArtId }) {
  return (
    <svg className="car-art" viewBox="0 0 440 210" aria-hidden="true">
      <use href={`#car-${art}`} />
    </svg>
  );
}

export function ExteriorSceneArt({ before }: { readonly before: boolean }) {
  return (
    <div
      className="art-scene"
      // Static, build-time markup from the approved reference; never user input.
      dangerouslySetInnerHTML={{ __html: exteriorSceneMarkup(before) }}
    />
  );
}
