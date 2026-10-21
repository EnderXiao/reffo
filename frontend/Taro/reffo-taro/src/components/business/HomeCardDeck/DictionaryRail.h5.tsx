import ReferenceTimeline from './ReferenceTimeline.h5'
import {REFERENCE_TIMELINE_ITEMS} from './referenceTimelineData'

export default function DictionaryRail() {
  return (
    <ReferenceTimeline
      items={REFERENCE_TIMELINE_ITEMS}
      activeIndex={0}
    />
  )
}
