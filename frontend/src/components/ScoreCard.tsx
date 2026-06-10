interface ScoreCardProps {
  label: string
  score: number
}

export function ScoreCard({ label, score }: ScoreCardProps) {
  return (
    <div className="score">
      {label}：<strong>{score}</strong> / 100
    </div>
  )
}
