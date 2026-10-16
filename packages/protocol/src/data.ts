import { z } from 'zod'

const Bytes = z.instanceof(Uint8Array)

export const DataToRenderer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('data'), seq: z.number().int().nonnegative(), bytes: Bytes }),
  z.object({ type: z.literal('exit'), code: z.number().int().nullable() }),
])
export type DataToRenderer = z.infer<typeof DataToRenderer>

export const DataFromRenderer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), bytes: Bytes }),
  z.object({ type: z.literal('ack'), bytes: z.number().int().positive() }),
])
export type DataFromRenderer = z.infer<typeof DataFromRenderer>
