import type {UploadedResumeFile} from '../types';

const HEADING_PATTERN = /^(#{1,6})\s*(.+?)\s*$/;

function stripInlineMarkdown(value: string) {
  return value
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getFileTitleFallback(fileName?: string | null) {
  if (!fileName) {
    return '未命名简历';
  }

  const normalizedName = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalizedName || '未命名简历';
}

export function extractResumeTitleFromMarkdown(markdown: string, fallbackTitle = '未命名简历') {
  const lines = markdown.split(/\r?\n/);
  let bestLevel = Number.POSITIVE_INFINITY;
  let bestTitle = '';

  for (const line of lines) {
    const match = line.match(HEADING_PATTERN);
    if (!match) {
      continue;
    }

    const level = match[1].length;
    const headingText = stripInlineMarkdown(match[2]);
    if (!headingText) {
      continue;
    }

    if (level < bestLevel) {
      bestLevel = level;
      bestTitle = headingText;
    }

    if (bestLevel === 1) {
      break;
    }
  }

  if (bestTitle) {
    return bestTitle;
  }

  const firstMeaningfulLine = lines
    .map(stripInlineMarkdown)
    .find(line => line.length > 0);

  return firstMeaningfulLine || fallbackTitle;
}

export function createUploadedFileMarkdownStub(fileName: string) {
  const fallbackTitle = getFileTitleFallback(fileName);

  return `# ${fallbackTitle}

> 已上传原始文件：${fileName}

请在这里补充或整理为 Markdown 简历内容。`;
}

export function buildSourceResumePayload(
  markdownDraft: string,
  file: UploadedResumeFile | null,
) {
  const fallbackTitle = getFileTitleFallback(file?.name);
  const normalizedMarkdown =
    markdownDraft.trim() ||
    file?.extractedText?.trim() ||
    (file ? createUploadedFileMarkdownStub(file.name) : '');
  const title = extractResumeTitleFromMarkdown(
    normalizedMarkdown,
    fallbackTitle,
  );

  return {
    title,
    resumeMarkdown: normalizedMarkdown,
    sourceType: file ? ('file' as const) : ('manual' as const),
    originalFileName: file?.name ?? `${title}.md`,
  };
}
