import {View} from '@tarojs/components'
import AppPageShell from '@/components/AppPageShell'
import {useDeviceLayoutMetrics} from '@/utils'
import AnalysisStage from './components/AnalysisStage'
import CreateCloseButton from './components/CreateCloseButton'
import CreateBackdrop from './components/CreateBackdrop'
import CreatePrimaryAction from './components/CreatePrimaryAction'
import CreateStepHeader from './components/CreateStepHeader'
import {CreateScrollStepLayout, CreateStaticStepLayout} from './components/CreateStepLayout'
import JobDescriptionStep from './steps/JobDescriptionStep'
import ResumeSummaryStep from './steps/ResumeSummaryStep'
import ResumeUploadStep from './steps/ResumeUploadStep'
import {styles} from './styles'
import type {CreatePageViewModel} from './usePageModel'

export default function PageView({
  currentStep,
  currentStepMeta,
  resumeUploadState,
  resumeSummaryState,
  jobDescriptionState,
  generationState,
  canSaveCurrentStep,
  isSavingCurrentStep,
  primaryActionLabel,
  handlePickResumeFile,
  handleRemoveResumeFile,
  handleEditSourceResume,
  handleDeleteSourceResume,
  handleResumeMarkdownChange,
  handleJobDescriptionChange,
  handleJobCompanyNameChange,
  handleJobPositionNameChange,
  handleJobLocationChange,
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
          <ResumeSummaryStep
            state={resumeSummaryState}
            onEdit={handleEditSourceResume}
            onDelete={handleDeleteSourceResume}
          />
        ) : (
          <ResumeUploadStep
            state={resumeUploadState}
            onPickFile={handlePickResumeFile}
            onRemoveFile={handleRemoveResumeFile}
            onMarkdownChange={handleResumeMarkdownChange}
          />
        )
      case 'jobDescription':
        return (
          <JobDescriptionStep
            state={jobDescriptionState}
            onCompanyNameChange={handleJobCompanyNameChange}
            onPositionNameChange={handleJobPositionNameChange}
            onLocationChange={handleJobLocationChange}
            onContentChange={handleJobDescriptionChange}
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
            <CreateCloseButton
              compact={isCompactJobDescriptionLayout}
              onClick={handleClose}
            />

            {isJobDescriptionStep ? (
              <CreateStaticStepLayout
                compact={isCompactJobDescriptionLayout}
                header={(
                  <CreateStepHeader
                    meta={currentStepMeta}
                    compact={isCompactJobDescriptionLayout}
                  />
                )}
              >
                <JobDescriptionStep
                  state={jobDescriptionState}
                  onCompanyNameChange={handleJobCompanyNameChange}
                  onPositionNameChange={handleJobPositionNameChange}
                  onLocationChange={handleJobLocationChange}
                  onContentChange={handleJobDescriptionChange}
                  onPickAttachment={handlePickJobAttachment}
                  compact={isCompactJobDescriptionLayout}
                  fillAvailableSpace
                />
              </CreateStaticStepLayout>
            ) : (
              <CreateScrollStepLayout
                compact={isCompactJobDescriptionLayout}
                header={(
                  <CreateStepHeader
                    meta={currentStepMeta}
                    compact={isCompactJobDescriptionLayout}
                  />
                )}
              >
                {renderStep()}
              </CreateScrollStepLayout>
            )}
            <CreatePrimaryAction
              stepId={currentStep}
              label={primaryActionLabel}
              disabled={!canSaveCurrentStep}
              loading={isSavingCurrentStep}
              compact={isCompactJobDescriptionLayout}
              onClick={handlePrimaryAction}
            />
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
