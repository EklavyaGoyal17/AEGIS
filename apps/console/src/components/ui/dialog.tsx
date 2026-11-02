'use client';

import {
  useEffect,
  useRef,
  useCallback,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

/* ------------------------------------------------------------------ */
/*  Dialog                                                            */
/* ------------------------------------------------------------------ */

export interface DialogProps {
  /** Whether the dialog is visible */
  open: boolean;
  /** Called when the dialog should close (backdrop click, Escape, X) */
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, children, className }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  /* Sync the `open` prop with the native <dialog> showModal / close */
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  /* Native <dialog> fires a `close` event on Escape – forward it */
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  /* Close on backdrop (::backdrop) click */
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      onClick={handleBackdropClick}
      aria-modal="true"
      className={clsx(
        /* reset browser defaults */
        'm-auto max-h-[85vh] w-full max-w-lg rounded-xl border border-surface-200 bg-surface-100 p-0 text-white shadow-2xl',
        'backdrop:bg-black/60 backdrop:backdrop-blur-sm',
        /* open animation */
        'open:animate-in open:fade-in-0 open:zoom-in-95',
        className,
      )}
    >
      <div
        className="relative flex flex-col gap-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className={clsx(
            'absolute right-4 top-4 rounded-md p-1 text-surface-400 transition-colors',
            'hover:bg-surface-200 hover:text-white',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
          )}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
        {children}
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  DialogTitle                                                       */
/* ------------------------------------------------------------------ */

export interface DialogTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode;
}

export function DialogTitle({ children, className, ...props }: DialogTitleProps) {
  return (
    <h2
      className={clsx('text-lg font-semibold leading-tight text-white', className)}
      {...props}
    >
      {children}
    </h2>
  );
}

/* ------------------------------------------------------------------ */
/*  DialogDescription                                                 */
/* ------------------------------------------------------------------ */

export interface DialogDescriptionProps
  extends HTMLAttributes<HTMLParagraphElement> {
  children: ReactNode;
}

export function DialogDescription({
  children,
  className,
  ...props
}: DialogDescriptionProps) {
  return (
    <p
      className={clsx('text-sm text-surface-400', className)}
      {...props}
    >
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/*  DialogActions                                                     */
/* ------------------------------------------------------------------ */

export interface DialogActionsProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function DialogActions({
  children,
  className,
  ...props
}: DialogActionsProps) {
  return (
    <div
      className={clsx('flex items-center justify-end gap-2 pt-2', className)}
      {...props}
    >
      {children}
    </div>
  );
}
