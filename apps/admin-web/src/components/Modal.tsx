import type { ReactNode } from 'react';
import { confirmOutsideReact } from '../ui/ConfirmDialog';
import { Modal as UiModal } from '../ui/Modal';

/**
 * @deprecated Shims for the legacy screens (UX_ADMIN §1.1). New screens use `Modal`, `Drawer` and
 * `useConfirm()` from src/ui. Delete this file when no legacy screen imports it.
 */

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

/**
 * The old modal's props, drawn by the new Modal (focus trap, Esc, labelled by its title, a bottom
 * sheet on phones). The content keeps the old look through the `.legacy` style scope.
 */
export function Modal({ title, open, onClose, children, width = 520 }: Props) {
  return (
    <UiModal open={open} title={title} onClose={onClose} width={width}>
      <div className="legacy legacy--modal">{children}</div>
    </UiModal>
  );
}

/**
 * @deprecated A blocking yes/no for old call sites written as `if (confirmDialog('…')) doIt()`, which
 * need an answer at once, so it stays the browser's own dialog. When touching a legacy screen, switch
 * to `const { ok } = await confirm({...})` from `useConfirm()`, or {@link confirmDialogAsync}.
 */
export function confirmDialog(message: string): boolean {
  // eslint-disable-next-line no-alert
  return window.confirm(message);
}

/**
 * The same question in the app's ConfirmDialog ("Go back" has the focus). For a legacy screen moving
 * off `window.confirm`: `if (!(await confirmDialogAsync(text, label))) return;`.
 */
export async function confirmDialogAsync(
  message: string,
  confirmLabel: string,
  options: { danger?: boolean } = {},
): Promise<boolean> {
  const { ok } = await confirmOutsideReact({
    title: message,
    confirmLabel,
    tone: options.danger ? 'danger' : 'default',
  });
  return ok;
}
