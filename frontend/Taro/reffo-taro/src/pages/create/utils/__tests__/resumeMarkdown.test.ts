import {
  buildSourceResumePayload,
  createUploadedFileMarkdownStub,
  extractResumeTitleFromMarkdown,
} from '../resumeMarkdown';

describe('resumeMarkdown utils', () => {
  test('应该取最高级标题作为简历标题', () => {
    const markdown = `## 工作经历

# Jeremy Smith

### 项目经历`;

    expect(extractResumeTitleFromMarkdown(markdown)).toBe('Jeremy Smith');
  });

  test('没有空格的 markdown 标题也应被识别', () => {
    const markdown = `#Jeremy Smith

## Experience`;

    expect(extractResumeTitleFromMarkdown(markdown)).toBe('Jeremy Smith');
  });

  test('没有标题时应回退到首个非空行', () => {
    const markdown = `前端工程师 / 5 年经验

负责设计系统和增长项目`;

    expect(extractResumeTitleFromMarkdown(markdown)).toBe('前端工程师 / 5 年经验');
  });

  test('上传二进制文件时应生成 markdown 草稿', () => {
    const stub = createUploadedFileMarkdownStub('CV-Jeremy-Smith.pdf');
    expect(stub).toContain('# CV Jeremy Smith');
    expect(stub).toContain('已上传原始文件：CV-Jeremy-Smith.pdf');
  });

  test('构建上传 payload 时应使用 markdown 中的标题', () => {
    const payload = buildSourceResumePayload('# Jane Doe\n\n## Experience', null);

    expect(payload.title).toBe('Jane Doe');
    expect(payload.sourceType).toBe('manual');
    expect(payload.originalFileName).toBe('Jane Doe.md');
  });
});
