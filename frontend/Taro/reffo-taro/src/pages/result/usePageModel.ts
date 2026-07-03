import {useEffect, useState} from 'react'
import Taro, {useRouter} from '@tarojs/taro'
import {useHistoryStore} from '@/store/historyStore'
import type {ProcessResult} from '@/types'
import {getLatestResultSession, type LatestResultSessionContext} from '@/utils/result-session'
import {createHistoryFromResult} from '@/utils/history-helper'
import {feedback} from '@/utils/feedback'
import {navigation} from '@/utils/navigation'

export interface ResultPageViewModel {
  result: ProcessResult | null
  loading: boolean
  saved: boolean
  handleSave: () => Promise<void>
  handleShare: () => Promise<void>
  handleBackHome: () => void
}

export function usePageModel(): ResultPageViewModel {
  const router = useRouter()
  const {addHistory} = useHistoryStore()
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [resultContext, setResultContext] =
    useState<LatestResultSessionContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const resultId = router.params.id

    if (resultId) {
      void loadFromHistory(resultId)
      return
    }

    void loadFromLatestSession()
  }, [router.params.id])

  const loadFromHistory = async (id: string) => {
    try {
      const {histories} = useHistoryStore.getState()
      const history = histories.find(item => item.id === id)

      if (history) {
        const processResult: ProcessResult = {
          analysis: {
            quality_score: history.qualityScore,
            strengths: [],
            weaknesses: [],
            suggestions: [],
            capability_summary: '',
            structured_resume: {
              personal_info: {name: history.name},
              education: [],
              experience: [],
              projects: [],
              skills: {hard_skills: [], soft_skills: []},
            },
          },
          matching: {
            match_score: history.matchScore,
            hard_requirements_match: [],
            skill_match: {
              matched_skills: history.tags,
              missing_skills: [],
              match_percentage: history.matchScore,
            },
            experience_match: {
              years_required: 0,
              years_actual: 0,
              relevant_experience: [],
              match_percentage: 0,
            },
            optimization_suggestions: [],
          },
          optimized: {
            optimized_resume: history.optimizedContent,
            changes_summary: [],
            improvement_score: 0,
          },
        }

        setResult(processResult)
        setSaved(true)
      } else {
        feedback.message('未找到结果')
        void navigation.navigateBack()
      }
    } catch (error) {
      console.error('加载历史记录失败:', error)
      feedback.error('加载失败')
    } finally {
      setLoading(false)
    }
  }

  const loadFromLatestSession = async () => {
    try {
      const session = await getLatestResultSession()

      if (session) {
        setResult(session.result)
        setResultContext(session.context)
      } else {
        feedback.message('未找到结果')
        void navigation.navigateBack()
      }
    } catch (error) {
      console.error('加载结果失败:', error)
      feedback.error('加载失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!result || saved) return

    try {
      const baseHistory = createHistoryFromResult(
        result,
        resultContext?.resumeContent || '',
        resultContext?.jdContent || '',
      )

      await addHistory({
        ...baseHistory,
        position: resultContext?.position.trim() || baseHistory.position,
        company: resultContext?.company.trim() || baseHistory.company,
      })

      setSaved(true)
      feedback.success('保存成功')
    } catch (error) {
      console.error('保存失败:', error)
      feedback.error('保存失败')
    }
  }

  const handleShare = async () => {
    try {
      await Taro.showShareMenu({withShareTicket: true})
    } catch (error) {
      console.error('分享失败:', error)
      feedback.message('分享功能暂不可用')
    }
  }

  const handleBackHome = () => {
    void navigation.reLaunch('/pages/index/index')
  }

  return {
    result,
    loading,
    saved,
    handleSave,
    handleShare,
    handleBackHome,
  }
}
