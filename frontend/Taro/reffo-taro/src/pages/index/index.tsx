import {Component, type ErrorInfo, type PropsWithChildren} from 'react'
import REFFO_LOGO from '../../assets/branding/reffo-logo.png'
import PageView from './PageView.h5'
import {usePageModel} from './model/usePageModel'

class LocalErrorBoundary extends Component<PropsWithChildren, {error: Error | null}> {
  state = {error: null as Error | null}
  static getDerivedStateFromError(error: Error) {
    console.error('[LOCAL ERROR BOUNDARY]', error.message, error.stack)
    return {error}
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[LOCAL ERROR BOUNDARY componentStack]', info.componentStack)
  }
  render() {
    if (this.state.error) {
      return <div style={{padding: 20, color: 'red', whiteSpace: 'pre-wrap' as const, fontSize: 12}}>
        {this.state.error.message + '\n' + this.state.error.stack}
      </div>
    }
    return this.props.children
  }
}

export default function Index() {
  return (
    <LocalErrorBoundary>
      <IndexInner />
    </LocalErrorBoundary>
  )
}

function IndexInner() {
  const model = usePageModel(REFFO_LOGO)
  return <PageView {...model} />
}
