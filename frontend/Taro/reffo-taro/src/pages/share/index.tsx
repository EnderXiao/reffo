import PageView from './PageView.h5'
import {usePageModel} from './usePageModel'

export default function SharePage() {
  const model = usePageModel()
  return <PageView {...model} />
}
