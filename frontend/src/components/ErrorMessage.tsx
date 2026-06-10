interface ErrorMessageProps {
  message: string
}

export function ErrorMessage({ message }: ErrorMessageProps) {
  return (
    <div className="error-message">
      <strong>错误：</strong> {message}
    </div>
  )
}
