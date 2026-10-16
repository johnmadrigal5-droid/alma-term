import * as RadixMenu from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'

export interface MenuItem {
  label: string
  onSelect(): void
  danger?: boolean
}

interface MenuProps {
  /** Accessible name of the icon-only trigger. */
  label: string
  trigger: ReactNode
  items: readonly MenuItem[]
}

// Dropdown on surface steps (Radix handles focus, arrows and Escape).
export function Menu({ label, trigger, items }: MenuProps) {
  return (
    <RadixMenu.Root modal={false}>
      <RadixMenu.Trigger
        aria-label={label}
        className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded text-faint hover:bg-s3 hover:text-text"
        // Keep the tree's own key handling (Enter, arrows) off the trigger.
        onKeyDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {trigger}
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 flex min-w-40 flex-col rounded-md bg-s2 p-1 text-text shadow-xl"
        >
          {items.map((item) => (
            <RadixMenu.Item
              key={item.label}
              onSelect={item.onSelect}
              className={`flex h-7 cursor-pointer items-center rounded px-2 text-sm outline-none data-[highlighted]:bg-s3 ${
                item.danger ? 'text-err' : ''
              }`}
            >
              {item.label}
            </RadixMenu.Item>
          ))}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  )
}
