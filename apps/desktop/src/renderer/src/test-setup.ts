import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest runs without globals, so Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

// jsdom lacks the layout APIs cmdk relies on; inert stand-ins are enough for behaviour tests.
class InertResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= InertResizeObserver
// Files that opt into the node environment have no DOM at all.
if (typeof Element !== 'undefined')
  Element.prototype.scrollIntoView ??= function scrollIntoView() {}
