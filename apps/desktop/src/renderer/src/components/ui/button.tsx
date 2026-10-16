import type { ComponentProps } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'md' | 'sm' | 'icon'

const variants: Record<Variant, string> = {
  primary: 'bg-accent font-semibold text-white hover:brightness-110',
  secondary: 'bg-s2 text-text hover:bg-s3',
  ghost: 'bg-transparent text-muted hover:bg-s2 hover:text-text',
}

const sizes: Record<Size, string> = {
  md: 'h-8 px-4 text-[13px]',
  sm: 'h-7 px-2 text-xs',
  icon: 'h-7 w-7 justify-center',
}

export type ButtonProps = ComponentProps<'button'> & { variant?: Variant; size?: Size }

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex cursor-pointer items-center gap-2 rounded-md transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  )
}
