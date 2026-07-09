import {Text, View} from '@tarojs/components'
import SvgIcon, {Path} from 'react-native-svg'
import {HOME_PAGE_CONTENT} from '../constants/content'
import {styles} from '../styles'

function GithubMark() {
  return (
    <SvgIcon width={19} height={19} viewBox='0 0 24 24' fill='none'>
      <Path
        fill='#111827'
        d='M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.05-1.61-4.05-1.61-.54-1.38-1.33-1.75-1.33-1.75-1.08-.75.08-.74.08-.74 1.2.08 1.83 1.23 1.83 1.23 1.06 1.83 2.79 1.3 3.47.99.11-.77.42-1.3.76-1.6-2.67-.3-5.48-1.33-5.48-5.94 0-1.31.47-2.39 1.23-3.23-.12-.3-.53-1.53.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.3-1.55 3.3-1.23 3.3-1.23.65 1.65.24 2.88.12 3.18.77.84 1.23 1.92 1.23 3.23 0 4.62-2.82 5.64-5.5 5.94.43.37.82 1.1.82 2.22 0 1.61-.01 2.91-.01 3.31 0 .32.21.7.82.58A12 12 0 0 0 12 .5Z'
      />
    </SvgIcon>
  )
}

interface HomeHeaderProps {
  onViewHistory: () => void
  hasSourceResume: boolean
  sourceResumeTitle: string | null
}

function truncateLabel(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

export default function HomeHeader({
  onViewHistory,
  hasSourceResume,
  sourceResumeTitle,
}: HomeHeaderProps) {
  const buttonStyle = hasSourceResume
    ? {...styles.sourceButton, ...styles.sourceButtonActive}
    : styles.sourceButton
  const buttonTextStyle = hasSourceResume
    ? {...styles.sourceButtonText, ...styles.sourceButtonTextActive}
    : styles.sourceButtonText
  const label = hasSourceResume && sourceResumeTitle
    ? truncateLabel(sourceResumeTitle, 16)
    : HOME_PAGE_CONTENT.header.sourceResumeLabel

  return (
    <View style={styles.header}>
      <View style={buttonStyle} onClick={onViewHistory}>
        {!hasSourceResume ? <Text style={styles.sourceButtonPlus}>+</Text> : null}
        <Text style={buttonTextStyle}>{label}</Text>
      </View>
      <View style={styles.githubButton}>
        <GithubMark />
      </View>
    </View>
  )
}
