import { z } from 'zod'

export const ThemeName = z.enum(['dark', 'light'])
export type ThemeName = z.infer<typeof ThemeName>
