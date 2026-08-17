import PageView from '../result/PageView'
import {usePageModel} from '../result/usePageModel'

export default function LandingResultPage() {
  const model = usePageModel({enteredFromLanding: true})
  return <PageView {...model} />
}
