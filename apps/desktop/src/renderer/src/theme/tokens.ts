export type ThemeName = 'dark' | 'light'

export interface ThemeTokens {
  canvas: string
  s1: string
  s2: string
  s3: string
  text: string
  muted: string
  faint: string
  accent: string
  accentText: string
  ok: string
  warn: string
  err: string
  termBg: string
  termFg: string
}

export const tokens: Record<ThemeName, ThemeTokens> = {
  dark: {
    canvas: '#131312',
    s1: '#1C1C1A',
    s2: '#242422',
    s3: '#2E2E2B',
    text: '#EDECE8',
    muted: '#A09F99',
    faint: '#9A9993',
    accent: '#5552D9',
    accentText: '#9BA1FF',
    ok: '#4ADE80',
    warn: '#FBBF24',
    err: '#F87171',
    termBg: '#0D0D0C',
    termFg: '#E7E5E0',
  },
  light: {
    canvas: '#F3F2EF',
    s1: '#FAFAF8',
    s2: '#EDECE8',
    s3: '#E3E1DC',
    text: '#1C1B19',
    muted: '#5E5D58',
    faint: '#5E5D58',
    accent: '#4F46E5',
    accentText: '#4740C9',
    ok: '#166534',
    warn: '#92400E',
    err: '#B91C1C',
    termBg: '#FFFFFF',
    termFg: '#1C1B19',
  },
}

export const TEXT_TOKENS = [
  'text',
  'muted',
  'faint',
  'accentText',
  'ok',
  'warn',
  'err',
] as const satisfies readonly (keyof ThemeTokens)[]

export const SURFACE_TOKENS = [
  'canvas',
  's1',
  's2',
  's3',
] as const satisfies readonly (keyof ThemeTokens)[]
