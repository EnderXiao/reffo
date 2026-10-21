/**
 * Mock @tarojs/components for Jest tests
 */
import React from 'react'

export const View = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ children, className, onClick, style, ...props }, ref) => (
  <div ref={ref} className={className} onClick={onClick} style={style} {...props}>
    {children}
  </div>
))
View.displayName = 'View'

export const Text = ({
  children,
  className,
  style,
  numberOfLines,
  ellipsizeMode,
  ...props
}: any) => (
  <span className={className} style={style} {...props}>
    {children}
  </span>
)

export const Textarea = ({
  value,
  placeholder,
  onInput,
  className,
  placeholderClass,
  maxlength,
  autoHeight,
  ...props
}: any) => {
  const handleChange = (e: any) => {
    if (onInput) {
      // 将标准的 onChange 事件转换为 Taro 的 onInput 事件格式
      const taroEvent = {
        detail: {
          value: e.detail?.value ?? e.target?.value ?? ''
        }
      }
      onInput(taroEvent)
    }
  }

  return (
    <textarea
      value={value}
      placeholder={placeholder}
      onChange={handleChange}
      onInput={handleChange}
      className={className}
      maxLength={maxlength}
      {...props}
    />
  )
}

export const Input = ({
  value,
  placeholder,
  onInput,
  className,
  type,
  ...props
}: any) => (
  <input
    value={value}
    placeholder={placeholder}
    onChange={onInput}
    className={className}
    type={type}
    {...props}
  />
)

export const Button = ({ children, onClick, className, disabled, ...props }: any) => (
  <button onClick={onClick} className={className} disabled={disabled} {...props}>
    {children}
  </button>
)

export const ScrollView = ({ children, className, onScroll, scrollY, ...props }: any) => (
  <div className={className} onScroll={onScroll} {...props}>
    {children}
  </div>
)

export const Image = ({ src, mode, className, onLoad, lazyLoad, ...props }: any) => (
  <img src={src} className={className} onLoad={onLoad} {...props} />
)
