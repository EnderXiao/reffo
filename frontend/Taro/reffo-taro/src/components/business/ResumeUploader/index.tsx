import {useEffect, useState} from 'react'
import {Text, Textarea, View} from '@tarojs/components'
import Taro from '@tarojs/taro'
import {StyleSheet} from 'react-native'
import {Button} from '@/components/Button'

export interface ResumeUploaderProps {
  value?: string
  onUpload: (content: string) => void
  maxSize?: number
  acceptTypes?: string[]
  placeholder?: string
  className?: string
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbe4ee',
    padding: 14,
  },
  textareaWrap: {
    minHeight: 180,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  textarea: {
    minHeight: 160,
    fontSize: 15,
    lineHeight: 22,
    color: '#111827',
    textAlignVertical: 'top',
  },
  count: {
    marginTop: 8,
    alignSelf: 'flex-end',
    color: '#6b7280',
    fontSize: 12,
  },
  error: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#fef2f2',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  clearWrap: {
    marginLeft: 10,
  },
  hint: {
    marginTop: 10,
  },
  hintText: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 18,
  },
})

export function ResumeUploader({
  value = '',
  onUpload,
  maxSize = 5,
  acceptTypes = ['.md', '.txt'],
  placeholder = '请输入简历内容，或点击下方按钮上传文件...',
}: ResumeUploaderProps) {
  const [content, setContent] = useState(value)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setContent(value)
  }, [value])

  const validateFileType = (fileName: string): boolean => {
    const extension = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
    return acceptTypes.includes(extension)
  }

  const validateFileSize = (size: number): boolean => {
    const maxSizeBytes = maxSize * 1024 * 1024
    return size <= maxSizeBytes
  }

  const handleTextChange = (event: any) => {
    const newContent = event.detail.value
    setContent(newContent)
    setError(null)
    onUpload(newContent)
  }

  const readFileContent = (filePath: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const fs = Taro.getFileSystemManager()
      fs.readFile({
        filePath,
        encoding: 'utf8',
        success: res => resolve(res.data as string),
        fail: reject,
      })
    })
  }

  const handleFileSelect = async () => {
    try {
      const res = await Taro.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: acceptTypes.map(ext => ext.replace('.', '')),
      })

      if (!res.tempFiles?.length) return

      const file = res.tempFiles[0]

      if (!validateFileType(file.name)) {
        const message = `不支持的文件类型，请选择 ${acceptTypes.join('、')} 格式的文件`
        setError(message)
        Taro.showToast({
          title: '不支持的文件类型',
          icon: 'none',
          duration: 2000,
        })
        return
      }

      if (!validateFileSize(file.size)) {
        const message = `文件大小超过限制（最大 ${maxSize}MB）`
        setError(message)
        Taro.showToast({
          title: `文件大小超过 ${maxSize}MB`,
          icon: 'none',
          duration: 2000,
        })
        return
      }

      const fileContent = await readFileContent(file.path)
      setContent(fileContent)
      setError(null)
      onUpload(fileContent)

      Taro.showToast({
        title: '文件上传成功',
        icon: 'success',
        duration: 1500,
      })
    } catch (err) {
      console.error('文件选择失败:', err)
      setError('文件选择失败，请重试')
      Taro.showToast({
        title: '文件选择失败',
        icon: 'none',
        duration: 2000,
      })
    }
  }

  const handleClear = () => {
    setContent('')
    setError(null)
    onUpload('')
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.textareaWrap}>
        <Textarea
          value={content}
          placeholder={placeholder}
          maxlength={-1}
          autoHeight
          onInput={handleTextChange}
          style={styles.textarea}
        />
      </View>

      {!!content && <Text style={styles.count}>{content.length} 字符</Text>}

      {error && (
        <View style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.actions}>
        <Button type='secondary' size='medium' onClick={handleFileSelect}>
          📁 选择文件
        </Button>
        {!!content && (
          <View style={styles.clearWrap}>
            <Button type='text' size='medium' onClick={handleClear}>
              清空
            </Button>
          </View>
        )}
      </View>

      <View style={styles.hint}>
        <Text style={styles.hintText}>
          支持 {acceptTypes.join('、')} 格式，最大 {maxSize}MB
        </Text>
      </View>
    </View>
  )
}
