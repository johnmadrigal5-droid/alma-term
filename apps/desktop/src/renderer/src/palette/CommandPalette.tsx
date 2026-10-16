import * as RadixDialog from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import type { PaletteCommand, PaletteGroup } from './palette-items'

interface Props {
  groups: readonly PaletteGroup[]
  onRun(command: PaletteCommand): void
  onClose(): void
}

const PLACEHOLDER = 'Conectar, buscar o ejecutar…'

// Radix returns focus to the element that opened the palette when it closes.
export function CommandPalette({ groups, onRun, onClose }: Props) {
  return (
    <RadixDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-canvas/70" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-24 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl bg-s1 text-text shadow-2xl"
        >
          <RadixDialog.Title className="sr-only">Paleta de comandos</RadixDialog.Title>
          <Command label="Paleta de comandos" loop>
            <Command.Input
              autoFocus
              placeholder={PLACEHOLDER}
              className="h-12 w-full bg-transparent px-4 text-[14px] text-text outline-none placeholder:text-faint"
            />
            <Command.List className="max-h-80 overflow-y-auto p-2">
              <Command.Empty className="px-2 py-4 text-center text-muted">
                Sin resultados
              </Command.Empty>
              {groups.map((group) => (
                <Command.Group
                  key={group.heading}
                  heading={group.heading}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-faint"
                >
                  {group.items.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={`${item.label} ${item.detail ?? ''}`}
                      onSelect={() => {
                        onClose()
                        onRun(item.command)
                      }}
                      className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 data-[selected=true]:bg-s3"
                    >
                      <span className="truncate">{item.label}</span>
                      {item.detail && (
                        <span className="ml-auto truncate font-mono text-xs text-muted">
                          {item.detail}
                        </span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
