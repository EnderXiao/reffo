import {Text, View} from '@tarojs/components'
import {useWindowDimensions} from 'react-native'
import ApplicationCardSurface from './ApplicationCardSurface'
import JobDescriptionField from './JobDescriptionField'
import {styles} from './JobDescriptionStep.styles'
import JobDescriptionUploadArea from './JobDescriptionUploadArea'
import type {JobDescriptionStepState} from '../types'

interface JobDescriptionStepProps {
  state: JobDescriptionStepState
  onCompanyNameChange: (content: string) => void
  onPositionNameChange: (content: string) => void
  onLocationChange: (content: string) => void
  onContentChange: (content: string) => void
  onPickAttachment: () => Promise<void>
  compact?: boolean
  fillAvailableSpace?: boolean
}

export default function JobDescriptionStep({
  state,
  onCompanyNameChange,
  onPositionNameChange,
  onLocationChange,
  onContentChange,
  onPickAttachment,
  compact = false,
  fillAvailableSpace = false,
}: JobDescriptionStepProps) {
  const {width: viewportWidth} = useWindowDimensions()
  const cardWidth = Math.round(viewportWidth * 0.8)
  const cardDynamicStyle = fillAvailableSpace ? {width: cardWidth, maxWidth: cardWidth} : null
  const tipDynamicStyle = fillAvailableSpace ? {width: cardWidth, maxWidth: cardWidth} : null
  const isUploadingAttachment = state.attachmentStatus === 'uploading'

  return (
    <View
      style={[
        styles.step,
        compact ? styles.stepCompact : null,
        fillAvailableSpace ? styles.stepFill : null,
      ] as any}
    >
      <View
        style={[
          styles.applicationCard,
          compact ? styles.applicationCardCompact : null,
          fillAvailableSpace ? styles.applicationCardFill : null,
          cardDynamicStyle,
        ] as any}
      >
        <ApplicationCardSurface compact={compact} />
        <View style={styles.cardHardware}>
          <View style={[styles.island, compact ? styles.islandCompact : null] as any} />
        </View>
        <View style={[styles.ribbonRow, compact ? styles.ribbonRowCompact : null] as any}>
          <View style={[styles.ribbonFold, compact ? styles.ribbonFoldCompact : null] as any} />
          <View style={[styles.ribbon, compact ? styles.ribbonCompact : null] as any}>
            <Text style={[styles.ribbonText, compact ? styles.ribbonTextCompact : null] as any}>
              新的工牌制作中！
            </Text>
          </View>
          <View style={[styles.ribbonTail, compact ? styles.ribbonTailCompact : null] as any} />
        </View>

        <View style={[styles.fieldRow, compact ? styles.fieldRowCompact : null] as any}>
          <JobDescriptionField
            label='公司'
            placeholder='输入公司名称'
            value={state.companyName}
            onChange={onCompanyNameChange}
            testId='job-company-input'
            compact={compact}
            disabled={isUploadingAttachment}
            containerStyle={[styles.fieldRowItem, styles.fieldRowItemLeft]}
          />

          <JobDescriptionField
            label='Base'
            placeholder='输入岗位城市'
            value={state.baseLocation}
            onChange={onLocationChange}
            testId='job-location-input'
            compact={compact}
            disabled={isUploadingAttachment}
            containerStyle={styles.fieldRowItem}
          />
        </View>

        <JobDescriptionField
          label='目标岗位名称'
          placeholder='输入岗位名称'
          value={state.positionName}
          onChange={onPositionNameChange}
          testId='job-position-input'
          compact={compact}
          disabled={isUploadingAttachment}
        />

        <View
          style={[
            styles.fieldBlock,
            compact ? styles.fieldBlockCompact : null,
            fillAvailableSpace ? styles.descriptionFieldFill : null,
          ] as any}
        >
          <Text style={[styles.fieldLabel, compact ? styles.fieldLabelCompact : null] as any}>
            目标岗位描述
          </Text>
          <View
            style={[
              styles.jdPanel,
              compact ? styles.jdPanelCompact : null,
              fillAvailableSpace ? styles.jdPanelFill : null,
            ] as any}
          >
            <JobDescriptionUploadArea
              state={state}
              onContentChange={onContentChange}
              onPickAttachment={onPickAttachment}
              compact={compact}
              fillAvailableSpace={fillAvailableSpace}
              disabled={isUploadingAttachment}
            />
          </View>
        </View>
      </View>

      <Text
        style={[
          styles.tipText,
          compact ? styles.tipTextCompact : null,
          fillAvailableSpace ? styles.tipTextFill : null,
          tipDynamicStyle,
        ] as any}
      >
        你也可以先填写公司和岗位名称，Reffo 会结合岗位描述一起组织最贴合的简历版本
      </Text>
    </View>
  )
}
