import type { ReactNode } from 'react';

type IconName =
  | 'drop'
  | 'home'
  | 'calendar'
  | 'car'
  | 'user'
  | 'pin'
  | 'down'
  | 'right'
  | 'close'
  | 'help'
  | 'info';

const paths: Record<IconName, ReactNode> = {
  drop: (
    <>
      <path d="M12 3C9.5 7 5 11.6 5 15a7 7 0 0 0 14 0c0-3.4-4.5-8-7-12Z" />
      <path d="M8.5 15.5a3.8 3.8 0 0 0 3 3" />
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
  right: <path d="m10 5 7 7-7 7" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
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
