import REFFO_LOGO from '../../assets/branding/reffo-logo.png'
import PageView from './PageView'
import {usePageModel} from './model/usePageModel'

export default function Index() {
  const model = usePageModel(REFFO_LOGO)
  return <PageView {...model} />
}
