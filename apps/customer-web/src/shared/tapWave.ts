import type { PointerEvent } from 'react';

const TAP_WAVE_LIFETIME_MS = 520;

/**
 * Approved press ripple. It is decoration only: it is skipped under reduced
 * motion and never delays or gates the action it decorates.
 */
export function spawnTapWave(event: PointerEvent<HTMLElement>): void {
  if (event.button !== 0) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  const wave = document.createElement('span');
  wave.className = 'tap-wave';
  wave.setAttribute('aria-hidden', 'true');
  wave.style.left = `${event.clientX - rect.left}px`;
  wave.style.top = `${event.clientY - rect.top}px`;
  target.appendChild(wave);
  window.setTimeout(() => wave.remove(), TAP_WAVE_LIFETIME_MS);
}
