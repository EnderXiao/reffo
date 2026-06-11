import {ScrollView, Text, View} from '@tarojs/components'
import AppPageShell from '@/components/AppPageShell'
import {useDeviceLayoutMetrics} from '@/utils'
import AnalysisStage from './components/AnalysisStage'
import CreateBackdrop from './components/CreateBackdrop'
import JobDescriptionStep from './steps/JobDescriptionStep'
import ResumeSummaryStep from './steps/ResumeSummaryStep'
import ResumeUploadStep from './steps/ResumeUploadStep'
import {styles} from './styles'
import type {CreatePageViewModel} from './usePageModel'

function getTitleToneStyle(tone: 'default' | 'accent' | 'warm') {
  if (tone === 'accent') {
    return styles.titleSegmentAccent
  }

  if (tone === 'warm') {
    return styles.titleSegmentWarm
  }

  return null
}

export default function PageView({
  currentStep,
  currentStepMeta,
  resumeUploadState,
  resumeSummaryState,
  jobDescriptionState,
  generationState,
  canSaveCurrentStep,
  isSavingCurrentStep,
  handlePickResumeFile,
  handleRemoveResumeFile,
  handleResumeMarkdownChange,
  handleJobDescriptionChange,
  handleJobCompanyNameChange,
  handleJobPositionNameChange,
  handleJobInputModeChange,
  handlePickJobAttachment,
  handlePrimaryAction,
  handleCancelGeneration,
  handleClose,
}: CreatePageViewModel) {
  const {floatingTopInset, pageBottomPadding, viewportHeight} = useDeviceLayoutMetrics()
  const isJobDescriptionStep = currentStep === 'jobDescription'
  const isCompactJobDescriptionLayout =
    isJobDescriptionStep && viewportHeight <= 860
  const lockedViewportStyle = isJobDescriptionStep ? {minHeight: viewportHeight} : null
  const frameTopInset = isJobDescriptionStep
    ? Math.max(0, floatingTopInset - 8)
    : floatingTopInset
  const primaryButtonVariantStyle =
    currentStep === 'jobDescription'
      ? styles.primaryButtonWarm
      : currentStep === 'resumeSummary'
        ? styles.primaryButtonDark
        : styles.primaryButtonCool
  const primaryButtonStyle =
    canSaveCurrentStep && !isSavingCurrentStep
      ? {...styles.primaryButton, ...primaryButtonVariantStyle}
      : {
          ...styles.primaryButton,
          ...primaryButtonVariantStyle,
          ...styles.primaryButtonDisabled,
        }

  const renderStep = () => {
    switch (currentStep) {
      case 'resumeUpload':
        return (
          <ResumeUploadStep
            state={resumeUploadState}
            onPickFile={handlePickResumeFile}
            onRemoveFile={handleRemoveResumeFile}
            onMarkdownChange={handleResumeMarkdownChange}
          />
        )
      case 'resumeSummary':
        return resumeSummaryState ? (
          <ResumeSummaryStep state={resumeSummaryState} />
        ) : null
      case 'jobDescription':
        return (
          <JobDescriptionStep
            state={jobDescriptionState}
            onCompanyNameChange={handleJobCompanyNameChange}
            onPositionNameChange={handleJobPositionNameChange}
            onContentChange={handleJobDescriptionChange}
            onInputModeChange={handleJobInputModeChange}
            onPickAttachment={handlePickJobAttachment}
          />
        )
      default:
        return null
    }
  }

  return (
    <AppPageShell
      navHidden
      backgroundColor='#ffffff'
      statusBarInset='none'
      statusBarTranslucent
      bodyStyle={styles.page}
    >
      <View style={styles.container}>
        <CreateBackdrop
          variant={currentStep === 'jobDescription' ? 'warm' : 'cool'}
        />
        <View style={styles.contentShell}>
          <View
            style={[
              styles.contentFrame,
              isCompactJobDescriptionLayout ? styles.contentFrameCompact : null,
              lockedViewportStyle,
              {
                paddingTop: frameTopInset,
                paddingBottom: pageBottomPadding,
              },
            ] as any}
          >
            <View
              style={[
                styles.chromeRow,
                isCompactJobDescriptionLayout ? styles.chromeRowCompact : null,
              ] as any}
            >
              <View
                style={styles.closeButton}
                onClick={handleClose}
                role='button'
                data-testid='create-flow-close'
              >
                <Text style={styles.closeButtonText}>×</Text>
              </View>
            </View>

            {isJobDescriptionStep ? (
              <View
                style={[
                  styles.staticContentArea,
                  isCompactJobDescriptionLayout ? styles.staticContentAreaCompact : null,
                ] as any}
              >
                <View
                  style={[
                    styles.staticContentBody,
                    isCompactJobDescriptionLayout ? styles.staticContentBodyCompact : null,
                  ] as any}
                >
                  <View style={styles.staticHeroSlot}>
                    <View
                      style={[
                        styles.heroBlock,
                        isCompactJobDescriptionLayout ? styles.heroBlockCompact : null,
                      ] as any}
                    >
                      <View style={styles.titleRow}>
                        {currentStepMeta.titleSegments.map(segment => (
                          <Text
                            key={`${currentStepMeta.id}-${segment.text}`}
                            style={[
                              styles.titleSegment,
                              isCompactJobDescriptionLayout ? styles.titleSegmentCompact : null,
                              getTitleToneStyle(segment.tone),
                            ] as any}
                          >
                            {segment.text}
                          </Text>
                        ))}
                      </View>
                      <Text
                        style={[
                          styles.description,
                          isCompactJobDescriptionLayout ? styles.descriptionCompact : null,
                        ] as any}
                      >
                        {currentStepMeta.description}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.staticStepSlot}>
                    <JobDescriptionStep
                      state={jobDescriptionState}
                      onCompanyNameChange={handleJobCompanyNameChange}
                      onPositionNameChange={handleJobPositionNameChange}
                      onContentChange={handleJobDescriptionChange}
                      onInputModeChange={handleJobInputModeChange}
                      onPickAttachment={handlePickJobAttachment}
                      compact={isCompactJobDescriptionLayout}
                      fillAvailableSpace
                    />
                  </View>
                </View>
              </View>
            ) : (
              <ScrollView
                scrollY
                style={[
                  styles.scrollArea,
                  isCompactJobDescriptionLayout ? styles.scrollAreaCompact : null,
                ] as any}
              >
                <View
                  style={[
                    styles.scrollContent,
                    isCompactJobDescriptionLayout ? styles.scrollContentCompact : null,
                  ] as any}
                >
                  <View
                    style={[
                      styles.heroBlock,
                      isCompactJobDescriptionLayout ? styles.heroBlockCompact : null,
                    ] as any}
                  >
                    <View style={styles.titleRow}>
                      {currentStepMeta.titleSegments.map(segment => (
                        <Text
                          key={`${currentStepMeta.id}-${segment.text}`}
                          style={[
                            styles.titleSegment,
                            isCompactJobDescriptionLayout ? styles.titleSegmentCompact : null,
                            getTitleToneStyle(segment.tone),
                          ] as any}
                        >
                          {segment.text}
                        </Text>
                      ))}
                    </View>
                    <Text
                      style={[
                        styles.description,
                        isCompactJobDescriptionLayout ? styles.descriptionCompact : null,
                      ] as any}
                    >
                      {currentStepMeta.description}
                    </Text>
                  </View>
                  {renderStep()}
                </View>
              </ScrollView>
            )}
            <View
              style={[
                styles.footer,
                isCompactJobDescriptionLayout ? styles.footerCompact : null,
              ] as any}
            >
              <View
                style={[
                  primaryButtonStyle,
                  isCompactJobDescriptionLayout ? styles.primaryButtonCompact : null,
                ] as any}
                onClick={handlePrimaryAction}
                role='button'
                aria-disabled={!canSaveCurrentStep || isSavingCurrentStep}
                data-testid='create-flow-primary-action'
              >
                <View style={styles.primaryButtonContent}>
                  {currentStep === 'jobDescription' ? (
                    <Text style={styles.primaryButtonSparkle}>✦</Text>
                  ) : null}
                  <Text
                    style={[
                      styles.primaryButtonText,
                      isCompactJobDescriptionLayout ? styles.primaryButtonTextCompact : null,
                    ] as any}
                  >
                    {isSavingCurrentStep ? '处理中...' : currentStepMeta.actionLabel}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>
        {generationState ? (
          <AnalysisStage
            state={generationState}
            topInset={frameTopInset}
            bottomInset={pageBottomPadding}
            onCancelGeneration={handleCancelGeneration}
          />
        ) : null}
      </View>
    </AppPageShell>
  )
}
