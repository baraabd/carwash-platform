import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

interface SheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/**
 * Approved bottom sheet: a native modal <dialog>, so focus trapping, Escape and
 * the inert background come from the platform rather than from custom key handling.
 */
export function Sheet({ open, title, onClose, children }: SheetProps) {
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

  const handleClose = () => {
    document.body.style.overflow = '';
    const opener = openerRef.current;
    if (opener instanceof HTMLElement && opener.isConnected) {
      opener.focus({ preventScroll: true });
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
      aria-labelledby="sheet-title"
      onClose={handleClose}
      onClick={handleBackdropClick}
    >
      <div className="sheet-inner">
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2 id="sheet-title">{title}</h2>
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
