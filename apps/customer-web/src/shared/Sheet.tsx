import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { createScrollLock } from './scrollLock';

interface SheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  /**
   * Identifies what the sheet is showing when one open sheet moves between views
   * (list → editor → confirmation). On a change the sheet starts again at its top
   * and takes the focus the replaced view was holding, as a newly shown sheet would.
   */
  readonly contentKey?: string;
  readonly children: ReactNode;
}

/** One lock per open sheet on the page's scrolling (see scrollLock.ts). */
const pageScroll = createScrollLock(() => document.body.style);

/**
 * Approved bottom sheet: a native modal <dialog>, so focus trapping, Escape and
 * the inert background come from the platform rather than from custom key handling.
 */
export function Sheet({ open, title, onClose, contentKey, children }: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<Element | null>(null);
  const [lockOwner] = useState(() => ({}));
  // Set when the owner asked for the close, so its later `close` event is known to
  // be an echo rather than a dismissal the owner has not heard about.
  const closedByOwner = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) {
        closedByOwner.current = true;
        dialog.close();
      }
      return;
    }
    if (!dialog.open) {
      closedByOwner.current = false;
      openerRef.current = document.activeElement;
      dialog.showModal();
      dialog.scrollTop = 0;
    }
    pageScroll.lock(lockOwner);
    // Runs when the owner closes the sheet or when it is unmounted while open, e.g.
    // when browser Back leaves the route that rendered it. A removed dialog never
    // fires `close`, so the lock must not depend on that event alone.
    return () => pageScroll.release(lockOwner);
  }, [open, lockOwner]);

  const shownContent = useRef(contentKey);
  useEffect(() => {
    if (shownContent.current === contentKey) return;
    shownContent.current = contentKey;
    const dialog = dialogRef.current;
    if (!dialog?.open) return;
    dialog.scrollTop = 0;
    // The control that was focused left with the old view; keep focus in the sheet.
    if (!dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
  }, [contentKey]);

  // The `close` event arrives as a later task, by which time the customer may have
  // moved on, reopened this sheet or opened another one. The browser has already
  // returned focus to the opener; this only covers the case where it could not, and
  // never takes focus from a control or unlocks scrolling under a sheet open now.
  const handleClose = () => {
    // This sheet was opened again before its old close event arrived: stale. The
    // echo is consumed, so the next close is judged on its own.
    if (dialogRef.current?.open) {
      closedByOwner.current = false;
      return;
    }
    const echo = closedByOwner.current;
    closedByOwner.current = false;
    pageScroll.release(lockOwner);
    const anotherSheetOpen = document.querySelector('dialog.sheet[open]') !== null;
    if (!anotherSheetOpen) {
      const opener = openerRef.current;
      const focusIsLost = !document.activeElement || document.activeElement === document.body;
      if (focusIsLost && opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    }
    // The owner already set `open` to false; telling it again could cancel a newer
    // request to reopen that has not rendered yet.
    if (!echo) onClose();
  };

  // Only the backdrop area above/beside the sheet dismisses it, as in the reference.
  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;
    if (!dialog || event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientY < rect.top || event.clientX < rect.left || event.clientX > rect.right) {
      dialog.close();
    }
  };

  // Rendered at the document root, like the reference, so it never inherits header layout.
  return createPortal(
    <dialog
      ref={dialogRef}
      className="sheet"
      tabIndex={contentKey === undefined ? undefined : -1}
      // Several sheets can be mounted at once but only one is open, and only the
      // open one carries the title id, so the id stays unique in the document.
      aria-labelledby={open ? 'sheet-title' : undefined}
      onClose={handleClose}
      onClick={handleBackdropClick}
    >
      <div className="sheet-inner">
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2 id={open ? 'sheet-title' : undefined}>{title}</h2>
          <button
            className="icon-btn"
            type="button"
            aria-label="إغلاق النافذة"
            onClick={() => dialogRef.current?.close()}
          >
            <Icon name="close" small />
          </button>
        </div>
        {open ? children : null}
      </div>
    </dialog>,
    document.body,
  );
}
