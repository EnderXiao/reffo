import {Pressable, Text, View} from 'react-native'
import CardTexture from './CardTexture.native'
import {deriveCardPalette, resolveCardInk} from './palette'
import type {HomeCardItem} from './shared'
import {styles} from './styles.native'

interface CreateDraftCardProps {
  title: string
  promptPrefix: string
  promptAccent: string
  onPress?: () => void
}

const DRAFT_CARD_SEED = '#7FB2FF'
const DRAFT_CARD_PALETTE = deriveCardPalette(DRAFT_CARD_SEED)
const DRAFT_CARD_ITEM: HomeCardItem = {
  id: 'draft-create-card',
  company: '',
  indexLabel: '',
  location: '',
  role: '',
  dateLabel: '',
  score: 88,
  primaryColor: DRAFT_CARD_PALETTE.primaryColor,
  surfaceColor: DRAFT_CARD_PALETTE.surfaceColor,
  stackColor: DRAFT_CARD_PALETTE.stackColor,
  logoColor: DRAFT_CARD_PALETTE.logoColor,
  borderColor: DRAFT_CARD_PALETTE.borderColor,
  tone: DRAFT_CARD_PALETTE.tone,
  strategyBody: '',
}

const draftInk = resolveCardInk(DRAFT_CARD_ITEM.tone, DRAFT_CARD_ITEM.primaryColor)

export default function CreateDraftCard({
  title,
  promptPrefix,
  promptAccent,
  onPress,
}: CreateDraftCardProps) {
  return (
    <Pressable
      style={[
        styles.createCardBase,
        {
          backgroundColor: DRAFT_CARD_ITEM.surfaceColor,
          borderColor: '#1c77eb',
        },
      ]}
      onPress={onPress}
    >
      <View style={styles.cardHandle} pointerEvents='none' />
      <View style={styles.textureWrap} pointerEvents='none'>
        <CardTexture item={DRAFT_CARD_ITEM} />
      </View>

      <View style={styles.createCardContent}>
        <Text style={[styles.createCardTitle, {color: draftInk.company}]}>{title}</Text>

        <View style={styles.createCardPromptWrap}>
          <Text style={[styles.createCardPromptText, {color: draftInk.body}]}>{promptPrefix}</Text>
          <Text style={[styles.createCardPromptAccent, {color: '#111111'}]}>{promptAccent}</Text>
        </View>
      </View>
    </Pressable>
  )
}
