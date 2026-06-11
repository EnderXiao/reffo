import {Text, View} from 'react-native'
import type {HomeCardItem} from './shared'
import {resolveCardGrade, resolveCardInk} from './palette'
import {styles} from './styles.native'

export function CardMainContent({item}: {item: HomeCardItem}) {
  const ink = resolveCardInk(item.tone, item.primaryColor)
  const grade = resolveCardGrade(item.score)
  const isDark = item.tone === 'dark'

  return (
    <>
      <View style={styles.cardContentTop}>
        <View style={styles.gradeRow}>
          <Text style={[styles.gradeLetter, {color: ink.grade}]}>{grade}</Text>
          <Text
            style={[
              styles.gradeMeta,
              isDark ? styles.gradeMetaDark : null,
              {color: ink.gradeMeta},
            ]}
          >
            评级
          </Text>
        </View>

        <View style={styles.fieldGroup}>
          <Text
            style={[
              styles.metaLabel,
              isDark ? styles.metaLabelDark : null,
              {color: ink.label},
            ]}
          >
            公司
          </Text>
          <Text
            style={[
              styles.cardCompany,
              isDark ? styles.cardCompanyDark : null,
              {color: ink.company},
            ]}
          >
            {item.company || '--'}
          </Text>
        </View>

        <View style={styles.fieldGroup}>
          <Text
            style={[
              styles.metaLabel,
              isDark ? styles.metaLabelDark : null,
              {color: ink.label},
            ]}
          >
            岗位
          </Text>
          <Text style={[styles.cardRole, isDark ? styles.cardBodyDark : null, {color: ink.body}]}>
            {item.role || '--'}
          </Text>
        </View>

        <View style={styles.fieldGroup}>
          <Text
            style={[
              styles.metaLabel,
              isDark ? styles.metaLabelDark : null,
              {color: ink.label},
            ]}
          >
            工作地
          </Text>
          <Text
            style={[
              styles.cardLocation,
              isDark ? styles.cardBodyDark : null,
              {color: ink.body},
            ]}
          >
            {item.location || '--'}
          </Text>
        </View>
      </View>

      <Text style={[styles.cardDate, isDark ? styles.cardDateDark : null, {color: ink.date}]}>
        {item.dateLabel}
      </Text>
    </>
  )
}
