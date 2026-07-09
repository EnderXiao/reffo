import PageView from './PageView'
import {usePageModel} from './usePageModel'

export default function ResultPage() {
  const model = usePageModel()
  return <PageView {...model} />
}
