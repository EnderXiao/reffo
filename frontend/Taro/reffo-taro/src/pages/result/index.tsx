import PageView from './PageView.h5'
import {usePageModel} from './usePageModel'

export default function ResultPage() {
  const model = usePageModel()
  return <PageView {...model} />
}
