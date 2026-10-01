export type CarArtId = 'sedan' | 'suv' | 'pickup';

function dustMarkup(): string {
  const specks = Array.from(
    { length: 32 },
    (_, i) =>
      `<ellipse cx="${53 + ((i * 47) % 333)}" cy="${114 + ((i * 13) % 44)}" rx="${2 + (i % 5)}" ry="${1 + (i % 3)}"/>`,
  ).join('');
  return `<g clip-path="url(#dust-clip)" opacity=".79"><rect x="37" y="104" width="370" height="63" fill="url(#dust-wash)"/><path d="M42 151q36-23 60-6t61-7 64 3 79-6 90 10v27H42Z" fill="#826e4777"/><g fill="#bea77699">${specks}</g><g stroke="#d5c29b55" stroke-width="2"><path d="m155 124 22 26m31-27 12 27m77-31 20 24m-80-8 49 4"/></g></g>`;
}

/**
 * Inner markup of the approved illustrative exterior scene (`sceneArt('exterior', before)`
 * in the reference). It is an illustration, not a photo of a real wash result.
 */
export function exteriorSceneMarkup(before: boolean): string {
  const background = `<rect width="600" height="440" fill="url(#studio-bg)"/><ellipse cx="316" cy="277" rx="270" ry="170" fill="url(#studio-halo)" opacity="${before ? '.35' : '.7'}"/><path d="M0 338 600 291v149H0Z" fill="#11271e" opacity=".85"/><path d="m0 339 600-48" stroke="#aaca7f24"/><g stroke="#cee1ac0c" fill="none"><circle cx="530" cy="70" r="120"/><circle cx="530" cy="70" r="160"/></g>`;
  const sparkle = before
    ? ''
    : `<g class="scene-spark" fill="none" stroke="#f0ffc3" stroke-width="2" opacity=".82"><path d="m444 205 3 10 10 3-10 3-3 10-3-10-10-3 10-3Z"/><path d="m202 184 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z"/></g>`;
  return `<svg viewBox="0 0 600 440" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${background}<ellipse cx="305" cy="333" rx="240" ry="24" fill="#06190e" opacity=".6"/><g transform="translate(0 81) scale(1.36)" ${before ? 'style="filter:saturate(.62) brightness(.88)"' : ''}><use href="#car-sedan" width="440" height="210"/>${before ? dustMarkup() : ''}</g>${sparkle}</svg>`;
}
