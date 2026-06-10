interface StepItem {
  number: number
  label: string
}

interface StepIndicatorProps {
  currentStep: number
  steps: StepItem[]
}

export function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  return (
    <div className="steps">
      {steps.map((step, index) => (
        <div className="step-group" key={step.number}>
          <div className={`step ${currentStep >= step.number ? 'active' : ''}`}>
            <span className="step-number">{step.number}</span>
            <span className="step-label">{step.label}</span>
          </div>
          {index < steps.length - 1 && <div className="step-divider" />}
        </div>
      ))}
    </div>
  )
}
