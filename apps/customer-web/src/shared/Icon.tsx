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
  | 'info'
  | 'check'
  | 'clock'
  | 'edit'
  | 'up'
  | 'plus'
  | 'lock'
  | 'trash'
  | 'seat'
  | 'wheel'
  | 'leaf'
  | 'minus'
  | 'target'
  | 'work'
  | 'message'
  | 'expand'
  | 'qr-pay'
  | 'download';

const paths: Record<IconName, ReactNode> = {
  check: <path d="m5 12 4 4L19 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  edit: <path d="m14 5 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14l-1 7Z" />,
  up: <path d="m6 15 6-6 6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  target: (
    <>
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
    </>
  ),
  work: (
    <>
      <rect x="3" y="7" width="18" height="14" rx="3" />
      <path d="M8 7V3h8v4M3 12a20 20 0 0 0 18 0m-9 0v3" />
    </>
  ),
  message: (
    <>
      <path d="M21 12a9 9 0 0 1-9 9H3l1.8-5A9 9 0 1 1 21 12Z" />
      <path d="M8 10h8m-8 4h5" />
    </>
  ),
  expand: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
  'qr-pay': (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="15" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="15" width="6" height="6" rx="1" />
      <path d="M15 15h3v3h3m-6 3h3m3-8v2M3 12h2m4 0h3V3m0 13v5" />
    </>
  ),
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="3" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2" />
    </>
  ),
  trash: <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />,
  seat: (
    <path d="m7 3-2 11a3 3 0 0 0 3 4h10a2 2 0 0 0 0-4h-8l2-9a2 2 0 0 0-5-2Zm1 15-1 4m11-4 1 4" />
  ),
  wheel: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v5m0 8v5M3 12h5m8 0h5m-11-2 2 2 2 2m0-4-4 4" />
    </>
  ),
  leaf: <path d="M20 3C8 2 3 7 5 14s15 10 15-11ZM4 21l12-13" />,
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
      <path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 3m0 3h.1" />
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
