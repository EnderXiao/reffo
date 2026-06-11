import PageView from './PageView'
import {usePageModel} from './usePageModel'

export default function CreatePage() {
  const model = usePageModel()
  return <PageView {...model} />
}
