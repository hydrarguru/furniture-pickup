import { X } from "lucide-react";
import { type MouseEvent, type RefObject, useEffect } from "react";

/** Opens the <dialog> as a modal while `open` is true. */
export function useModal(dialog: RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [dialog, open]);
}

/**
 * Backdrop clicks are delivered to the <dialog> itself, but so are clicks on its padding.
 * True only when the pointer is outside the dialog's box. Clicks on its content have those
 * elements as target and never count.
 */
export function isBackdropClick(e: MouseEvent<HTMLDialogElement>) {
  if (e.target !== e.currentTarget) return false;
  const box = e.currentTarget.getBoundingClientRect();
  return (
    e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="danger lightbox-close" onClick={onClick} aria-label="Stäng">
      <X size={20} strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}
