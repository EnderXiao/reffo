import {Image, Input, Text, Textarea, View} from '@tarojs/components'
import {StyleSheet, useWindowDimensions} from 'react-native'
import SvgIcon, {Defs, Ellipse, LinearGradient, Rect, Stop} from 'react-native-svg'
import type {
  JobDescriptionInputMode,
  JobDescriptionStepState,
} from '../types'

interface JobDescriptionStepProps {
  state: JobDescriptionStepState
  onCompanyNameChange: (content: string) => void
  onPositionNameChange: (content: string) => void
  onContentChange: (content: string) => void
  onInputModeChange: (mode: JobDescriptionInputMode) => void
  onPickAttachment: () => Promise<void>
  compact?: boolean
  fillAvailableSpace?: boolean
}

function readInputValue(event: any) {
  return event?.detail?.value ?? event?.target?.value ?? ''
}

function DocumentGlyph({
  tone = 'muted',
  compact = false,
}: {
  tone?: 'muted' | 'accent'
  compact?: boolean
}) {
  const paperStyle = [
    styles.documentGlyph,
    tone === 'accent' ? styles.documentGlyphAccent : styles.documentGlyphMuted,
    compact ? styles.documentGlyphCompact : null,
  ] as any
  const foldStyle = [
    styles.documentGlyphFold,
    tone === 'accent' ? styles.documentGlyphFoldAccent : styles.documentGlyphFoldMuted,
    compact ? styles.documentGlyphFoldCompact : null,
  ] as any
  const lineToneStyle = tone === 'accent' ? styles.documentGlyphLineAccent : null

  return (
    <View style={paperStyle}>
      <View style={foldStyle} />
      <View style={[styles.documentGlyphLineShort, lineToneStyle] as any} />
      <View style={[styles.documentGlyphLineLong, lineToneStyle] as any} />
      <View style={[styles.documentGlyphLineShort, lineToneStyle] as any} />
    </View>
  )
}

function PencilGlyph({
  active = false,
}: {
  active?: boolean
}) {
  return (
    <View style={styles.pencilGlyph}>
      <View
        style={[
          styles.pencilGlyphBody,
          active ? styles.pencilGlyphBodyActive : null,
        ] as any}
      />
      <View
        style={[
          styles.pencilGlyphTip,
          active ? styles.pencilGlyphTipActive : null,
        ] as any}
      />
    </View>
  )
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  testId,
  compact = false,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  testId: string
  compact?: boolean
}) {
  return (
    <View style={[styles.fieldBlock, compact ? styles.fieldBlockCompact : null] as any}>
      <Text style={[styles.fieldLabel, compact ? styles.fieldLabelCompact : null] as any}>
        {label}
      </Text>
      <View style={[styles.inputShell, compact ? styles.inputShellCompact : null] as any}>
        <Input
          value={value}
          placeholder={placeholder}
          onInput={event => onChange(readInputValue(event))}
          style={[styles.input, compact ? styles.inputCompact : null] as any}
          data-testid={testId}
        />
      </View>
    </View>
  )
}

function ModeTab({
  mode,
  active,
  onClick,
  testId,
  compact = false,
}: {
  mode: JobDescriptionInputMode
  active: boolean
  onClick: () => void
  testId: string
  compact?: boolean
}) {
  return (
    <View
      style={
        active
          ? {...styles.modeTab, ...(compact ? styles.modeTabCompact : {}), ...styles.modeTabActive}
          : {...styles.modeTab, ...(compact ? styles.modeTabCompact : {})}
      }
      onClick={onClick}
      role='button'
      data-testid={testId}
    >
      {mode === 'upload' ? (
        <View style={styles.modeTabUploadIcon}>
          <View
            style={[
              styles.modeTabUploadIconFrame,
              active ? styles.modeTabUploadIconFrameActive : null,
            ] as any}
          >
            <View
              style={[
                styles.modeTabUploadIconStem,
                active ? styles.modeTabUploadIconStemActive : null,
              ] as any}
            />
            <View
              style={[
                styles.modeTabUploadIconArrow,
                active ? styles.modeTabUploadIconArrowActive : null,
              ] as any}
            />
          </View>
        </View>
      ) : <PencilGlyph active={active} />}
    </View>
  )
}

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
  compact = false,
  fillAvailableSpace = false,
}: {
  compact?: boolean
  fillAvailableSpace?: boolean
}) {
  return (
    <View
      style={[
        styles.loadingPanel,
        compact ? styles.loadingPanelCompact : null,
        fillAvailableSpace ? styles.loadingPanelFill : null,
      ] as any}
      data-testid='job-upload-loading'
    >
      <View style={styles.previewBadge}>
        <View style={styles.previewBadgeRing} />
        <View style={styles.previewBadgeInner}>
          <DocumentGlyph tone='accent' compact />
        </View>
      </View>
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

function UploadArea({
  state,
  onContentChange,
  onPickAttachment,
  compact = false,
  fillAvailableSpace = false,
}: {
  state: JobDescriptionStepState
  onContentChange: (content: string) => void
  onPickAttachment: () => Promise<void>
  compact?: boolean
  fillAvailableSpace?: boolean
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
          onInput={event => onContentChange(readInputValue(event))}
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
    return <UploadLoadingPanel compact={compact} fillAvailableSpace={fillAvailableSpace} />
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

function ApplicationCardSurface({compact = false}: {compact?: boolean}) {
  const baseId = compact ? 'job-description-card-base-compact' : 'job-description-card-base'
  const sheenId = compact ? 'job-description-card-sheen-compact' : 'job-description-card-sheen'

  return (
    <View
      pointerEvents='none'
      style={[styles.cardSurface, compact ? styles.cardSurfaceCompact : null] as any}
    >
      <SvgIcon width='100%' height='100%' style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={baseId} x1='0%' y1='0%' x2='100%' y2='100%'>
            <Stop offset='0%' stopColor='#fffdfb' />
            <Stop offset='58%' stopColor='#fff8f2' />
            <Stop offset='100%' stopColor='#fff3e9' />
          </LinearGradient>
          <LinearGradient id={sheenId} x1='100%' y1='0%' x2='72%' y2='100%'>
            <Stop offset='0%' stopColor='#ffffff' stopOpacity={0.96} />
            <Stop offset='34%' stopColor='#ffffff' stopOpacity={0.52} />
            <Stop offset='100%' stopColor='#ffffff' stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x='0' y='0' width='100%' height='100%' fill={`url(#${baseId})`} />
        <Ellipse
          cx='84%'
          cy='44%'
          rx={compact ? 88 : 96}
          ry={compact ? 114 : 126}
          fill='#ffd7bf'
          fillOpacity={0.42}
        />
        <Ellipse
          cx='18%'
          cy='82%'
          rx={compact ? 64 : 74}
          ry={compact ? 78 : 92}
          fill='#ffe7d8'
          fillOpacity={0.72}
        />
        <Rect x='0' y='0' width='100%' height='100%' fill={`url(#${sheenId})`} />
      </SvgIcon>
    </View>
  )
}

export default function JobDescriptionStep({
  state,
  onCompanyNameChange,
  onPositionNameChange,
  onContentChange,
  onInputModeChange,
  onPickAttachment,
  compact = false,
  fillAvailableSpace = false,
}: JobDescriptionStepProps) {
  const {width: viewportWidth} = useWindowDimensions()
  const cardWidth = Math.round(viewportWidth * 0.8)
  const cardDynamicStyle = fillAvailableSpace ? {width: cardWidth, maxWidth: cardWidth} : null
  const tipDynamicStyle = fillAvailableSpace ? {width: cardWidth, maxWidth: cardWidth} : null

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

        <Field
          label='公司（可选）'
          placeholder='输入公司名称'
          value={state.companyName}
          onChange={onCompanyNameChange}
          testId='job-company-input'
          compact={compact}
        />

        <Field
          label='岗位名称（可选）'
          placeholder='输入岗位名称'
          value={state.positionName}
          onChange={onPositionNameChange}
          testId='job-position-input'
          compact={compact}
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
            <UploadArea
              state={state}
              onContentChange={onContentChange}
              onPickAttachment={onPickAttachment}
              compact={compact}
              fillAvailableSpace={fillAvailableSpace}
            />

            <View style={styles.modeBar}>
              <ModeTab
                mode='upload'
                active={state.inputMode === 'upload'}
                onClick={() => onInputModeChange('upload')}
                testId='job-mode-upload'
                compact={compact}
              />
              <View style={styles.modeBarDivider} />
              <ModeTab
                mode='manual'
                active={state.inputMode === 'manual'}
                onClick={() => onInputModeChange('manual')}
                testId='job-mode-manual'
                compact={compact}
              />
            </View>
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

const styles = StyleSheet.create({
  step: {
    width: '100%',
    alignItems: 'center',
    paddingBottom: 20,
  },
  stepCompact: {
    paddingTop: 4,
    paddingBottom: 4,
  },
  stepFill: {
    flex: 1,
    minHeight: 0,
  },
  applicationCard: {
    position: 'relative',
    width: '100%',
    maxWidth: 330,
    alignSelf: 'center',
    borderRadius: 30,
    borderWidth: 1,
    borderColor: '#ebddd2',
    backgroundColor: 'transparent',
    paddingTop: 25,
    paddingHorizontal: 16,
    paddingBottom: 18,
    shadowColor: '#d4b4a2',
    shadowOffset: {width: 0, height: 12},
    shadowOpacity: 0.15,
    shadowRadius: 22,
    elevation: 4,
  },
  applicationCardCompact: {
    maxWidth: 304,
    paddingTop: 24,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  applicationCardFill: {
    flex: 1,
    minHeight: 0,
  },
  cardSurface: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 30,
    overflow: 'hidden',
    backgroundColor: '#fff8f3',
  },
  cardSurfaceCompact: {
    borderRadius: 30,
  },
  cardHardware: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 3,
  },
  island: {
    width: 88,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(170, 171, 178, 0.95)',
  },
  islandCompact: {
    width: 70,
    height: 6,
    backgroundColor: 'rgba(162, 165, 170, 0.82)',
  },
  ribbonRow: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'stretch',
    alignSelf: 'flex-start',
    marginLeft: -16,
    marginBottom: 14,
    shadowColor: '#7b9bd1',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.12,
    shadowRadius: 9,
    elevation: 2,
  },
  ribbonRowCompact: {
    marginLeft: -14,
    marginTop: 2,
    marginBottom: 12,
  },
  ribbonFold: {
    position: 'absolute',
    left: 0,
    bottom: -5,
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderRightWidth: 7,
    borderTopColor: '#234fba',
    borderRightColor: 'transparent',
  },
  ribbonFoldCompact: {
    bottom: -3,
    borderTopWidth: 3,
    borderRightWidth: 5,
  },
  ribbon: {
    justifyContent: 'center',
    minHeight: 27,
    backgroundColor: '#2f6fe3',
    paddingLeft: 13,
    paddingRight: 12,
    borderTopRightRadius: 7,
    borderBottomRightRadius: 7,
  },
  ribbonCompact: {
    minHeight: 20,
    paddingLeft: 8,
    paddingRight: 8,
  },
  ribbonTail: {
    width: 0,
    height: 0,
    borderTopWidth: 13.5,
    borderBottomWidth: 13.5,
    borderLeftWidth: 10,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#2f6fe3',
  },
  ribbonTailCompact: {
    borderTopWidth: 10,
    borderBottomWidth: 10,
    borderLeftWidth: 7,
  },
  ribbonText: {
    color: '#ffffff',
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  ribbonTextCompact: {
    fontSize: 9.5,
    lineHeight: 11,
  },
  fieldBlock: {
    marginBottom: 12,
  },
  fieldBlockCompact: {
    marginBottom: 6,
  },
  descriptionFieldFill: {
    flex: 1,
    minHeight: 0,
  },
  fieldLabel: {
    color: '#25211f',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    marginBottom: 7,
  },
  fieldLabelCompact: {
    fontSize: 14,
    lineHeight: 18,
    marginBottom: 5,
  },
  inputShell: {
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#eee0d4',
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 16,
    minHeight: 46,
    justifyContent: 'center',
  },
  inputShellCompact: {
    minHeight: 40,
    paddingHorizontal: 10,
  },
  input: {
    color: '#36383d',
    fontSize: 15,
    lineHeight: 21,
  },
  inputCompact: {
    fontSize: 14,
    lineHeight: 18,
  },
  jdPanel: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#eddccf',
    backgroundColor: 'rgba(255,251,247,0.76)',
    overflow: 'hidden',
    minHeight: 228,
  },
  jdPanelCompact: {
    minHeight: 166,
  },
  jdPanelFill: {
    flex: 1,
    minHeight: 0,
  },
  uploadPanel: {
    minHeight: 182,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  uploadPanelCompact: {
    minHeight: 126,
    paddingVertical: 8,
  },
  uploadPanelFill: {
    flex: 1,
  },
  uploadIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: '#efe5df',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#d6c0b6',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
    marginBottom: 8,
  },
  uploadIconWrapCompact: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginBottom: 6,
  },
  uploadIconPlate: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fffdfa',
    borderWidth: 1,
    borderColor: '#ece1db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadIconPlateCompact: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  documentGlyph: {
    width: 30,
    height: 36,
    borderRadius: 8,
    borderWidth: 1.8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
  },
  documentGlyphCompact: {
    width: 22,
    height: 28,
    borderRadius: 6,
    paddingTop: 3,
  },
  documentGlyphMuted: {
    borderColor: '#c6b9b2',
    backgroundColor: '#faf6f2',
  },
  documentGlyphAccent: {
    borderColor: '#f27b59',
    backgroundColor: '#fff6ef',
  },
  documentGlyphFold: {
    position: 'absolute',
    right: -2,
    top: -2,
    width: 10,
    height: 10,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    transform: [{rotate: '0deg'}],
  },
  documentGlyphFoldCompact: {
    width: 8,
    height: 8,
  },
  documentGlyphFoldMuted: {
    backgroundColor: '#ffffff',
    borderColor: '#c6b9b2',
  },
  documentGlyphFoldAccent: {
    backgroundColor: '#ffece1',
    borderColor: '#f27b59',
  },
  documentGlyphLineShort: {
    width: 12,
    height: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(198, 185, 178, 0.82)',
    marginBottom: 4,
  },
  documentGlyphLineLong: {
    width: 16,
    height: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(198, 185, 178, 0.82)',
    marginBottom: 4,
  },
  documentGlyphLineAccent: {
    backgroundColor: 'rgba(242, 123, 89, 0.62)',
  },
  uploadTitle: {
    color: '#d2c3bb',
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  uploadTitleCompact: {
    color: '#c8b8b0',
    fontSize: 16,
    lineHeight: 20,
  },
  uploadSubtitle: {
    marginTop: 4,
    color: '#cdbeb6',
    fontSize: 11.5,
    lineHeight: 17,
    textAlign: 'center',
  },
  uploadSubtitleCompact: {
    marginTop: 3,
    color: '#c6b7af',
    fontSize: 10.5,
    lineHeight: 15,
  },
  loadingPanel: {
    minHeight: 182,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  loadingPanelCompact: {
    minHeight: 126,
    paddingVertical: 8,
  },
  loadingPanelFill: {
    flex: 1,
  },
  previewPanel: {
    position: 'relative',
    minHeight: 182,
    backgroundColor: '#f5ede9',
  },
  previewPanelCompact: {
    minHeight: 126,
  },
  previewPanelFill: {
    flex: 1,
    minHeight: 0,
  },
  previewImage: {
    width: '100%',
    height: 182,
  },
  previewImageCompact: {
    height: 126,
  },
  previewImageFill: {
    height: '100%',
  },
  previewImageMask: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  previewBadge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 58,
    height: 58,
    marginLeft: -29,
    marginTop: -29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBadgeRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: '#ff6c43',
  },
  previewBadgeInner: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filePanel: {
    minHeight: 182,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  filePanelCompact: {
    minHeight: 126,
    paddingVertical: 8,
  },
  filePanelFill: {
    flex: 1,
  },
  filePanelIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: '#ff6c43',
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  filePanelIconCompact: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginBottom: 12,
  },
  filePanelName: {
    color: '#6f625b',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  filePanelNameCompact: {
    fontSize: 14,
    lineHeight: 20,
  },
  filePanelMeta: {
    marginTop: 4,
    color: '#b2a49d',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  filePanelMetaCompact: {
    lineHeight: 17,
  },
  errorPanel: {
    minHeight: 182,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  errorPanelCompact: {
    minHeight: 126,
    paddingVertical: 8,
  },
  errorPanelFill: {
    flex: 1,
  },
  errorBadge: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    borderColor: '#ff8f77',
    backgroundColor: '#fff6f2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  errorBadgeCompact: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginBottom: 12,
  },
  errorBadgeText: {
    color: '#ff6c43',
    fontSize: 28,
    lineHeight: 28,
    fontWeight: '700',
  },
  errorBadgeTextCompact: {
    fontSize: 24,
    lineHeight: 24,
  },
  errorTitle: {
    color: '#8a6055',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  errorTitleCompact: {
    fontSize: 15,
    lineHeight: 20,
  },
  errorSubtitle: {
    marginTop: 6,
    color: '#b7978e',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  errorSubtitleCompact: {
    marginTop: 4,
    lineHeight: 18,
  },
  textareaWrap: {
    minHeight: 182,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: 'rgba(255,250,246,0.62)',
  },
  textareaWrapCompact: {
    minHeight: 126,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 5,
  },
  textareaWrapFill: {
    flex: 1,
    minHeight: 0,
  },
  textarea: {
    minHeight: 160,
    color: '#3a3a3a',
    fontSize: 16,
    lineHeight: 24,
    textAlignVertical: 'top',
  },
  textareaCompact: {
    minHeight: 113,
    fontSize: 14,
    lineHeight: 20,
  },
  textareaFill: {
    flex: 1,
    minHeight: 0,
  },
  modeBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#efdfd4',
    backgroundColor: 'rgba(255,248,243,0.84)',
    minHeight: 42,
  },
  modeBarDivider: {
    width: 1,
    backgroundColor: '#f2e7df',
  },
  modeTab: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTabCompact: {
    minHeight: 36,
  },
  modeTabActive: {
    backgroundColor: '#fffdf9',
  },
  modeTabGlyph: {
    color: '#d1c4bc',
    fontSize: 18,
    lineHeight: 18,
    fontWeight: '700',
  },
  modeTabGlyphActive: {
    color: '#f27b59',
    fontSize: 18,
    lineHeight: 18,
    fontWeight: '700',
  },
  pencilGlyph: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pencilGlyphBody: {
    width: 13,
    height: 2.4,
    borderRadius: 999,
    backgroundColor: '#d1c4bc',
    transform: [{rotate: '-34deg'}],
  },
  pencilGlyphBodyActive: {
    backgroundColor: '#f27b59',
  },
  pencilGlyphTip: {
    position: 'absolute',
    right: 2,
    top: 8,
    width: 5,
    height: 5,
    borderTopWidth: 1.8,
    borderRightWidth: 1.8,
    borderColor: '#d1c4bc',
    transform: [{rotate: '12deg'}],
  },
  pencilGlyphTipActive: {
    borderColor: '#f27b59',
  },
  modeTabUploadIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTabUploadIconFrame: {
    width: 19,
    height: 17,
    borderWidth: 1.8,
    borderColor: '#d1c4bc',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  modeTabUploadIconFrameActive: {
    borderColor: '#f27b59',
  },
  modeTabUploadIconStem: {
    position: 'absolute',
    top: -9,
    width: 1.8,
    height: 11,
    backgroundColor: '#d1c4bc',
  },
  modeTabUploadIconStemActive: {
    backgroundColor: '#f27b59',
  },
  modeTabUploadIconArrow: {
    position: 'absolute',
    top: -9,
    width: 0,
    height: 0,
    borderLeftWidth: 5.5,
    borderRightWidth: 5.5,
    borderBottomWidth: 7.5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#d1c4bc',
  },
  modeTabUploadIconArrowActive: {
    borderBottomColor: '#f27b59',
  },
  tipText: {
    width: '100%',
    maxWidth: 304,
    alignSelf: 'center',
    marginTop: 8,
    color: '#beb1aa',
    fontSize: 12.5,
    lineHeight: 18,
  },
  tipTextCompact: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 16,
  },
  tipTextFill: {
    marginTop: 6,
    alignSelf: 'center',
  },
})
