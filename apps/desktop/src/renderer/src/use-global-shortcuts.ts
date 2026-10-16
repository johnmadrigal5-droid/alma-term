import { useEffect } from 'react'
import { useMultiExec } from './multiexec/multiexec-store'
import { nextPreset } from './layout/panes'
import { matchShortcut } from './shortcuts'
import { usePanes } from './state/panes-store'
import { useSessions } from './state/sessions-store'
import { useUi } from './state/ui-store'

function focusInTerminal(): boolean {
  return document.activeElement?.closest('.xterm') != null
}

export function useGlobalShortcuts(
  onNewLocal: () => void,
  onPalette: () => void,
  onCloseTab: () => void,
): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = matchShortcut(event, window.api.platform, { inTerminal: focusInTerminal() })
      if (!action) return
      event.preventDefault()
      const store = useSessions.getState()
      switch (action.type) {
        case 'newLocal':
          onNewLocal()
          return
        case 'nextTab':
          store.cycle(1)
          return
        case 'prevTab':
          store.cycle(-1)
          return
        case 'selectTab':
          store.selectIndex(action.index)
          return
        case 'palette':
          onPalette()
          return
        case 'toggleSftp':
          useUi.getState().toggleSftp()
          return
        case 'closeTab':
          onCloseTab()
          return
        case 'splitPanes': {
          const panes = usePanes.getState()
          panes.setPreset(nextPreset(panes.preset))
          return
        }
        case 'multiExec':
          useMultiExec.getState().focusField()
          return
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onNewLocal, onPalette, onCloseTab])
}
