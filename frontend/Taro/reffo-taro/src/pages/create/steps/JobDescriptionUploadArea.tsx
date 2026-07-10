import {Image, Text, Textarea, View} from '@tarojs/components'
import {StyleSheet} from 'react-native'
import SvgIcon, {Circle} from 'react-native-svg'
import {styles} from './JobDescriptionStep.styles'
import {DocumentGlyph} from './JobDescriptionStepGlyphs'
import {readInputValue} from './JobDescriptionStep.utils'
import type {JobDescriptionStepState} from '../types'

function UploadIdlePanel({
  onPickAttachment,
  compact = false,
  fillAvailableSpace = false,
}: {
  onPickAttachment: () => Promise<void>
  compact?: boolean
  fillAvailableSpace?: boolean
}) {
  return (
    <View
      style={[
        styles.uploadPanel,
        compact ? styles.uploadPanelCompact : null,
        fillAvailableSpace ? styles.uploadPanelFill : null,
      ] as any}
      onClick={onPickAttachment}
      role='button'
      data-testid='job-upload-trigger'
    >
      <View style={[styles.uploadIconWrap, compact ? styles.uploadIconWrapCompact : null] as any}>
        <View
          style={[
            styles.uploadIconPlate,
            compact ? styles.uploadIconPlateCompact : null,
          ] as any}
        >
          <DocumentGlyph />
        </View>
      </View>
      <Text style={[styles.uploadTitle, compact ? styles.uploadTitleCompact : null] as any}>
        上传岗位描述截图
      </Text>
      <Text style={[styles.uploadSubtitle, compact ? styles.uploadSubtitleCompact : null] as any}>
        点击选择
      </Text>
    </View>
  )
}

function UploadLoadingPanel({
  progress,
  compact = false,
  fillAvailableSpace = false,
}: {
  progress: number
  compact?: boolean
  fillAvailableSpace?: boolean
}) {
  const size = compact ? 58 : 66
  const strokeWidth = 3
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const normalizedProgress = Math.max(0, Math.min(100, progress))
  const strokeDashoffset = circumference * (1 - normalizedProgress / 100)

  return (
    <View
      style={[
        styles.loadingPanel,
        compact ? styles.loadingPanelCompact : null,
        fillAvailableSpace ? styles.loadingPanelFill : null,
      ] as any}
      data-testid='job-upload-loading'
    >
      <View style={[styles.uploadProgressBadge, compact ? styles.uploadProgressBadgeCompact : null] as any}>
        <SvgIcon width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={StyleSheet.absoluteFill}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke='#f0e3dc'
            strokeWidth={strokeWidth}
            fill='none'
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke='#ff6c43'
            strokeWidth={strokeWidth}
            fill='none'
            strokeLinecap='round'
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{transition: 'stroke-dashoffset 260ms cubic-bezier(0.4, 0, 0.2, 1)'} as any}
          />
        </SvgIcon>
        <View style={styles.previewBadgeInner}>
          <DocumentGlyph tone='accent' compact />
        </View>
      </View>
      <Text style={[styles.uploadSubtitle, compact ? styles.uploadSubtitleCompact : null] as any}>
        正在解析图片 {Math.round(normalizedProgress)}%
      </Text>
    </View>
  )
}

function UploadErrorPanel({
  message,
  onPickAttachment,
  compact = false,
  fillAvailableSpace = false,
}: {
  message: string
  onPickAttachment: () => Promise<void>
  compact?: boolean
  fillAvailableSpace?: boolean
}) {
  return (
    <View
      style={[
        styles.errorPanel,
        compact ? styles.errorPanelCompact : null,
        fillAvailableSpace ? styles.errorPanelFill : null,
      ] as any}
      onClick={onPickAttachment}
      role='button'
      data-testid='job-upload-error'
    >
      <View style={[styles.errorBadge, compact ? styles.errorBadgeCompact : null] as any}>
        <Text style={[styles.errorBadgeText, compact ? styles.errorBadgeTextCompact : null] as any}>
          !
        </Text>
      </View>
      <Text style={[styles.errorTitle, compact ? styles.errorTitleCompact : null] as any}>
        上传失败
      </Text>
      <Text style={[styles.errorSubtitle, compact ? styles.errorSubtitleCompact : null] as any}>
        {message}
      </Text>
    </View>
  )
}

function UploadSuccessPanel({
  state,
  onPickAttachment,
  compact = false,
  fillAvailableSpace = false,
}: {
  state: JobDescriptionStepState
  onPickAttachment: () => Promise<void>
  compact?: boolean
  fillAvailableSpace?: boolean
}) {
  if (!state.attachment) {
    return null
  }

  if (state.attachment.previewPath) {
    return (
      <View
        style={[
          styles.previewPanel,
          compact ? styles.previewPanelCompact : null,
          fillAvailableSpace ? styles.previewPanelFill : null,
        ] as any}
        onClick={onPickAttachment}
        role='button'
        data-testid='job-upload-preview'
      >
        <Image
          src={state.attachment.previewPath}
          style={[
            styles.previewImage,
            compact ? styles.previewImageCompact : null,
            fillAvailableSpace ? styles.previewImageFill : null,
          ] as any}
          mode='aspectFill'
        />
        <View style={styles.previewImageMask} />
        <View style={styles.previewBadge}>
          <View style={styles.previewBadgeInner}>
            <DocumentGlyph tone='accent' compact />
          </View>
        </View>
      </View>
    )
  }

  return (
    <View
      style={[
        styles.filePanel,
        compact ? styles.filePanelCompact : null,
        fillAvailableSpace ? styles.filePanelFill : null,
      ] as any}
      onClick={onPickAttachment}
      role='button'
      data-testid='job-upload-file'
    >
      <View style={[styles.filePanelIcon, compact ? styles.filePanelIconCompact : null] as any}>
        <DocumentGlyph tone='accent' compact />
      </View>
      <Text style={[styles.filePanelName, compact ? styles.filePanelNameCompact : null] as any}>
        {state.attachment.name}
      </Text>
      <Text style={[styles.filePanelMeta, compact ? styles.filePanelMetaCompact : null] as any}>
        {state.attachment.sizeLabel || '已选择附件'}
      </Text>
    </View>
  )
}

export default function JobDescriptionUploadArea({
  state,
  onContentChange,
  onPickAttachment,
  compact = false,
  fillAvailableSpace = false,
  disabled = false,
}: {
  state: JobDescriptionStepState
  onContentChange: (content: string) => void
  onPickAttachment: () => Promise<void>
  compact?: boolean
  fillAvailableSpace?: boolean
  disabled?: boolean
}) {
  if (state.inputMode === 'manual') {
    return (
      <View
        style={[
          styles.textareaWrap,
          compact ? styles.textareaWrapCompact : null,
          fillAvailableSpace ? styles.textareaWrapFill : null,
        ] as any}
      >
        <Textarea
          value={state.content}
          placeholder='请输入职位描述、岗位要求，或简单描述你的目标岗位方向'
          maxlength={10000}
          autoHeight
          disabled={disabled}
          onInput={event => {
            if (!disabled) {
              onContentChange(readInputValue(event))
            }
          }}
          style={[
            styles.textarea,
            compact ? styles.textareaCompact : null,
            fillAvailableSpace ? styles.textareaFill : null,
          ] as any}
          data-testid='job-description-input'
        />
      </View>
    )
  }

  if (state.attachmentStatus === 'uploading') {
    return (
      <UploadLoadingPanel
        progress={state.attachmentProgress}
        compact={compact}
        fillAvailableSpace={fillAvailableSpace}
      />
    )
  }

  if (state.attachmentStatus === 'error') {
    return (
      <UploadErrorPanel
        message={state.attachmentErrorMessage || '文件读取失败，请重试'}
        onPickAttachment={onPickAttachment}
        compact={compact}
        fillAvailableSpace={fillAvailableSpace}
      />
    )
  }

  if (state.attachmentStatus === 'success' && state.attachment) {
    return (
      <UploadSuccessPanel
        state={state}
        onPickAttachment={onPickAttachment}
        compact={compact}
        fillAvailableSpace={fillAvailableSpace}
      />
    )
  }

  return (
    <UploadIdlePanel
      onPickAttachment={onPickAttachment}
      compact={compact}
      fillAvailableSpace={fillAvailableSpace}
    />
  )
}
