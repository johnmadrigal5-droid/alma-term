import { createTransfers } from './transfers-store'

// window.api is read at call time so importing this module needs no preload.
export const useTransfers = createTransfers({
  start: (args) => window.api.transfers.start(args),
  pause: (args) => window.api.transfers.pause(args),
  resume: (args) => window.api.transfers.resume(args),
  cancel: (args) => window.api.transfers.cancel(args),
  localExists: (args) => window.api.transfers.localExists(args),
})
