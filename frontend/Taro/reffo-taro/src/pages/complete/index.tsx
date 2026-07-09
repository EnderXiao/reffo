import PageView from './PageView'
import {usePageModel} from './usePageModel'

export default function CompletePage() {
  const model = usePageModel()
  return <PageView {...model} />
}
