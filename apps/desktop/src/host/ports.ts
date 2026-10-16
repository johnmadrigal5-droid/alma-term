import type { MessagePort as NodeMessagePort } from 'node:worker_threads'

export interface PortLike {
  postMessage(message: unknown): void
  onMessage(listener: (message: unknown) => void): void
  onClose(listener: () => void): void
  close(): void
}

// Structural shape of Electron's MessagePortMain; the host never imports electron.
export interface ElectronPortShape {
  postMessage(message: unknown): void
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown
  on(event: 'close', listener: () => void): unknown
  start(): void
  close(): void
}

export function fromElectronPort(port: ElectronPortShape): PortLike {
  let started = false
  return {
    postMessage: (message) => port.postMessage(message),
    onMessage: (listener) => {
      port.on('message', (event) => listener(event.data))
      if (!started) {
        started = true
        port.start()
      }
    },
    onClose: (listener) => {
      port.on('close', listener)
    },
    close: () => port.close(),
  }
}

export function fromNodePort(port: NodeMessagePort): PortLike {
  return {
    postMessage: (message) => port.postMessage(message),
    onMessage: (listener) => {
      port.on('message', listener)
    },
    onClose: (listener) => {
      port.on('close', listener)
    },
    close: () => port.close(),
  }
}
