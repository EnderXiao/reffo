interface TagListProps {
  items: string[]
  variant: 'success' | 'warning'
}

export function TagList({ items, variant }: TagListProps) {
  return (
    <div className="tags">
      {items.map((item, index) => (
        <span className={`tag tag-${variant}`} key={`${item}-${index}`}>
          {item}
        </span>
      ))}
    </div>
  )
}
