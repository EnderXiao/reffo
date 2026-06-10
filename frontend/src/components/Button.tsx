import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: ButtonVariant
}

export function Button({
  children,
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = ['btn', `btn-${variant}`, className].filter(Boolean).join(' ')

  return (
    <button className={classes} type={type} {...props}>
      {children}
    </button>
  )
}
