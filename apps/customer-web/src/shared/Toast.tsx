import { useEffect, useState } from 'react';

const TOAST_VISIBLE_MS = 4000;

interface ToastProps {
  readonly message: string | null;
  /** Changes whenever a new notice is raised, so a repeated message shows again. */
  readonly sequence: number;
}

export function Toast({ message, sequence }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), TOAST_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [message, sequence]);

  return (
    <div
      className={visible ? 'toast show' : 'toast'}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </div>
  );
}
