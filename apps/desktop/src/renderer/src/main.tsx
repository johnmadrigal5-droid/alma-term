import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { listenForPorts } from './terminal/port-registry'
import { portRegistry } from './terminal/port-registry-instance'
import { applyTheme } from './theme/apply-theme'

applyTheme(window.api.initialTheme)
listenForPorts(window, portRegistry)

const el = document.getElementById('root')
if (!el) throw new Error('Falta el elemento #root')
// No StrictMode: its double effects would reattach sessions twice and steal data ports.
createRoot(el).render(<App />)
