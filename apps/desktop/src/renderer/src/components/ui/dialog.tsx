import * as RadixDialog from '@radix-ui/react-dialog'
import { useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'

interface DialogProps {
  open: boolean
  title: string
  description?: ReactNode
  tone?: 'default' | 'danger'
  /** Called for Escape, outside clicks and the close request; the caller decides what it means. */
  onDismiss(): void
  children: ReactNode
  contentProps?: Omit<ComponentPropsWithoutRef<typeof RadixDialog.Content>, 'children'>
}

// Modal with trapped focus (Radix), styled on surface steps instead of borders.
export function Dialog({
  open,
  title,
  description,
  tone = 'default',
  onDismiss,
  children,
  contentProps,
}: DialogProps) {
  // What had the focus when the dialog mounted (the button that opened it). Radix records it
  // too, but an autofocused field grabs the focus first and it would remember that field.
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onDismiss()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay data-alma-overlay="" className="fixed inset-0 bg-canvas/70" />
        <RadixDialog.Content
          {...contentProps}
          onCloseAutoFocus={(event) => {
            contentProps?.onCloseAutoFocus?.(event)
            if (event.defaultPrevented) return
            event.preventDefault()
            if (opener?.isConnected) opener.focus()
          }}
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          className={`fixed left-1/2 top-1/2 flex w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl bg-s1 p-6 text-text shadow-2xl ${
            tone === 'danger' ? 'ring-2 ring-err' : ''
          }`}
        >
          <RadixDialog.Title
            className={`m-0 text-base font-semibold ${tone === 'danger' ? 'text-err' : ''}`}
          >
            {title}
          </RadixDialog.Title>
          {description !== undefined && (
            <RadixDialog.Description className="m-0 leading-normal text-muted">
              {description}
            </RadixDialog.Description>
          )}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
