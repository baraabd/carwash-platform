import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

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

/**
 * Approved bottom sheet: a native modal <dialog>, so focus trapping, Escape and
 * the inert background come from the platform rather than from custom key handling.
 */
export function Sheet({ open, title, onClose, contentKey, children }: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      openerRef.current = document.activeElement;
      dialog.showModal();
      document.body.style.overflow = 'hidden';
      dialog.scrollTop = 0;
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

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
  // moved on or opened another sheet. The browser has already returned focus to
  // the opener; this only covers the case where it could not, and never takes
  // focus from a control or unlocks scrolling under a sheet that is open now.
  const handleClose = () => {
    const anotherSheetOpen = document.querySelector('dialog.sheet[open]') !== null;
    if (!anotherSheetOpen) {
      document.body.style.overflow = '';
      const opener = openerRef.current;
      const focusIsLost = !document.activeElement || document.activeElement === document.body;
      if (focusIsLost && opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    }
    onClose();
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
