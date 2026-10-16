import { clampSize } from '@alma/protocol'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import { passesToTerminal } from '../shortcuts'
import { useTheme } from '../theme/use-theme'
import { currentTokens } from '../theme/apply-theme'
import { fromXterm } from '../multiexec/translate'
import { connectTerminal, sendInput } from './connect-terminal'
import { bindContextClick } from './context-click'
import { mayTakeFocus } from './focus'
import { trackPaste } from './paste-tracker'
import { portRegistry } from './port-registry-instance'
import { terminals } from './terminal-registry'

interface Props {
  sessionId: string
  generation: number
  active: boolean
  onExit(code: number | null): void
}

export function TerminalView({ sessionId, generation, active, onExit }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const onExitRef = useRef(onExit)
  const [connected, setConnected] = useState(false)
  const theme = useTheme((s) => s.theme)

  useEffect(() => {
    onExitRef.current = onExit
  }, [onExit])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const colors = currentTokens()
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 14,
      cursorBlink: true,
      scrollback: 10_000,
      theme: {
        background: colors.termBg,
        foreground: colors.termFg,
        cursor: colors.accentText,
        selectionBackground: colors.s3,
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    const paste = trackPaste(el)
    const unbindContext = bindContextClick(el, term, paste, navigator.clipboard)
    if (!window.api.flags.disableWebgl) {
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => webgl.dispose())
        term.loadAddon(webgl)
      } catch {
        // WebGL unavailable: xterm keeps its DOM renderer.
      }
    }
    term.attachCustomKeyEventHandler((event) => passesToTerminal(event, window.api.platform))
    termRef.current = term
    setConnected(false)

    let disposed = false
    let disconnect: (() => void) | null = null
    let unregister: (() => void) | null = null
    let resizeTimer: number | undefined

    const sendResize = () => {
      void window.api.session.resize({ sessionId, ...clampSize(term.cols, term.rows) })
    }
    const refit = () => {
      // Hidden tabs report 0×0; never send that size to the pty.
      if (el.clientWidth === 0 || el.clientHeight === 0) return
      fit.fit()
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(sendResize, 50)
    }

    void portRegistry.take(sessionId).then((port) => {
      if (disposed) {
        port.close()
        return
      }
      disconnect = connectTerminal(term, port, {
        onExit: (code) => onExitRef.current(code),
        onInput: (data) => terminals.emitInput(sessionId, fromXterm(data, paste.active())),
      })
      unregister = terminals.register(sessionId, {
        modes: () => ({
          applicationCursorKeysMode: term.modes.applicationCursorKeysMode,
          bracketedPasteMode: term.modes.bracketedPasteMode,
        }),
        write: (text) => sendInput(port, text),
      })
      setConnected(true)
      refit()
    })

    const observer = new ResizeObserver(refit)
    observer.observe(el)

    return () => {
      disposed = true
      observer.disconnect()
      window.clearTimeout(resizeTimer)
      unregister?.()
      unbindContext()
      paste.dispose()
      disconnect?.()
      term.dispose()
      termRef.current = null
    }
  }, [sessionId, generation])

  // The page tokens were applied before this runs: the terminal picks its colors from them.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const colors = currentTokens()
    term.options.theme = {
      background: colors.termBg,
      foreground: colors.termFg,
      cursor: colors.accentText,
      selectionBackground: colors.s3,
    }
  }, [theme])

  useEffect(() => {
    if (active && connected && mayTakeFocus(document.activeElement)) termRef.current?.focus()
  }, [active, connected])

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full px-1 py-2" />
      {!connected && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 grid place-items-center text-muted"
        >
          Iniciando shell…
        </div>
      )}
    </div>
  )
}
