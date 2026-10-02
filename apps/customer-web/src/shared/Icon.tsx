import type { ReactNode } from 'react';

export type IconName =
  | 'drop'
  | 'spark'
  | 'home'
  | 'calendar'
  | 'car'
  | 'user'
  | 'pin'
  | 'down'
  | 'left'
  | 'right'
  | 'arrow'
  | 'close'
  | 'shield'
  | 'wallet'
  | 'van'
  | 'history'
  | 'refresh'
  | 'help'
  | 'info';

const paths: Record<IconName, ReactNode> = {
  drop: (
    <>
      <path d="M12 3C9.5 7 5 11.6 5 15a7 7 0 0 0 14 0c0-3.4-4.5-8-7-12Z" />
      <path d="M8.5 15.5a3.8 3.8 0 0 0 3 3" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      <path d="M20 3v4m-2-2h4" />
    </>
  ),
  home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="4" />
      <path d="M7 3v4m10-4v4M3 11h18M8 15h2m4 0h2m-8 3h2" />
    </>
  ),
  car: (
    <>
      <path d="m4 11 2-6h12l2 6M4 11h16a1 1 0 0 1 1 1v6H3v-6a1 1 0 0 1 1-1ZM5 18v3m14-3v3M3 9H1m22 0h-2" />
      <path d="M6 14h2m8 0h2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </>
  ),
  pin: (
    <>
      <path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  down: <path d="m6 9 6 6 6-6" />,
  left: <path d="m14 5-7 7 7 7" />,
  right: <path d="m10 5 7 7-7 7" />,
  arrow: <path d="M20 12H4m6-6-6 6 6 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  shield: (
    <>
      <path d="m12 3 8 3v6c0 4.3-8 9-8 9s-8-4.7-8-9V6l8-3Z" />
      <path d="m8 12 3 3 5-5" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="5" width="18" height="15" rx="3" />
      <path d="M3 7V5a2 2 0 0 1 2-2h13M21 11h-5a2 2 0 0 0 0 4h5m-4-2h.1" />
    </>
  ),
  van: (
    <>
      <path d="M2 5h13v13H2V5Zm13 5h4l3 4v4h-7" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M15 14h7" />
    </>
  ),
  history: <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v6l4 2" />,
  refresh: <path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.7 9a2.4 2.4 0 1 1 4.4 1.4c-.9 1.1-2.1 1.3-2.1 3.1m0 3.5v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.1" />
    </>
  ),
};

export function Icon({ name, small = false }: { name: IconName; small?: boolean }) {
  return (
    <svg aria-hidden="true" className={small ? 'icon sm' : 'icon'} viewBox="0 0 24 24" fill="none">
      {paths[name]}
    </svg>
  );
}
