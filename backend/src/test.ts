/**
 * 测试脚本
 * 用于验证三个 Agent 的完整流程
 */

const API_BASE_URL = 'http://localhost:3000'

// 测试用的简历 Markdown
const testResume = `# 张三

**联系方式**：186-1234-5678 | zhangsan@example.com | 北京

**当前职位**：高级后端开发工程师

---

## 工作经历

### ABC科技有限公司 | 高级后端开发工程师 | 2021.03 - 至今

**职责与成就：**

- 负责电商平台后端系统的开发与维护，使用 Java/Spring Boot 构建微服务架构
- 参与系统架构设计，优化数据库查询性能，查询响应时间降低60%
- 带领3人小组完成订单系统重构，提升系统吞吐量至 5000 QPS
- 参与技术选型和代码审查，推动团队技术规范落地

### XYZ互联网公司 | 后端开发工程师 | 2019.07 - 2021.02

**职责与成就：**

- 开发和维护用户中心、支付系统等核心模块
- 使用 Redis 实现分布式缓存，提升系统响应速度
- 参与微服务拆分，完成单体应用向微服务架构的迁移

---

## 项目经验

### 电商平台订单系统 | 技术负责人 | 2022.01 - 2022.08

**项目描述**：重构电商平台订单系统，支持高并发场景

**技术栈**：Java, Spring Cloud, MySQL, Redis, RocketMQ, Kubernetes

**主要工作与成果：**

- 设计并实现基于事件驱动的订单处理流程，解决分布式事务问题
- 引入消息队列实现订单异步处理，系统吞吐量提升3倍
- 优化数据库表结构和索引，查询性能提升60%

---

## 教育背景

### 清华大学 | 计算机科学与技术 | 本科 | 2015.09 - 2019.06

- 获得校级优秀毕业生称号
- 参与ACM竞赛，获得区域赛铜奖

---

## 技能清单

**编程语言**：Java, Python, SQL

**框架与工具**：Spring Boot, Spring Cloud, MyBatis, Redis, Docker, Kubernetes

**数据库**：MySQL, Redis, MongoDB

**软技能**：团队协作、问题解决、技术分享`

// 测试用的 JD
const testJD = `岗位职责：
1. 负责公司核心业务系统的后端开发，包括但不限于用户系统、订单系统、支付系统等
2. 参与系统架构设计，优化系统性能，保证系统的稳定性和可扩展性
3. 参与技术方案评审，推动技术创新和最佳实践落地
4. 指导初级工程师，进行代码审查和技术分享

任职要求：
1. 本科及以上学历，计算机相关专业
2. 3年以上 Java 后端开发经验，熟悉 Spring Boot、Spring Cloud 等主流框架
3. 熟悉微服务架构，有分布式系统开发经验
4. 熟悉 MySQL、Redis 等数据库，有性能优化经验
5. 熟悉 Docker、Kubernetes 等容器技术
6. 具备良好的团队协作能力和问题解决能力
7. 有电商、金融等行业经验者优先

加分项：
- 有大规模分布式系统开发经验
- 熟悉消息队列（Kafka、RocketMQ）
- 了解前端技术栈（React、Vue）
- 有技术博客或开源项目`

/**
 * 测试完整流程
 */
async function testFullProcess() {
  console.log('========================================')
  console.log('开始测试完整流程')
  console.log('========================================\n')

  try {
    console.log('发送请求到 POST /api/v1/mvp/process ...\n')

    const response = await fetch(`${API_BASE_URL}/api/v1/mvp/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resume_markdown: testResume,
        jd_text: testJD,
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const result = await response.json()

    if (!result.success) {
      console.error('❌ 处理失败:', result.error)
      return
    }

    console.log('\n========================================')
    console.log('✅ 处理成功！')
    console.log('========================================\n')

    // 打印结果
    const { step1_analysis, step2_matching, step3_optimized_resume } = result.data

    console.log('【Step 1: 简历分析】')
    console.log('─'.repeat(40))
    console.log(`质量评分: ${step1_analysis.quality_score}/100`)
    console.log(`\n优势 (${step1_analysis.strengths.length})：`)
    step1_analysis.strengths.forEach((s: string, i: number) => console.log(`  ${i + 1}. ${s}`))
    console.log(`\n问题 (${step1_analysis.weaknesses.length})：`)
    step1_analysis.weaknesses.forEach((w: string, i: number) => console.log(`  ${i + 1}. ${w}`))
    console.log(`\n能力总结：\n  ${step1_analysis.capability_summary}`)

    console.log('\n【Step 2: 匹配分析】')
    console.log('─'.repeat(40))
    console.log(`匹配度评分: ${step2_matching.match_score}/100`)
    console.log(`\n岗位：${step2_matching.jd_structure.basic_info.title}`)
    console.log(`\n已匹配技能 (${step2_matching.skill_match.matched.length})：`)
    console.log(`  ${step2_matching.skill_match.matched.join(', ')}`)
    console.log(`\n缺失技能 (${step2_matching.skill_match.missing.length})：`)
    console.log(`  ${step2_matching.skill_match.missing.join(', ')}`)
    console.log(`\n经验匹配度：\n  ${step2_matching.experience_match}`)

    console.log('\n【Step 3: 优化简历】')
    console.log('─'.repeat(40))
    console.log(`简历长度: ${step3_optimized_resume.length} 字符`)
    console.log('\n优化后的简历内容：')
    console.log('─'.repeat(40))
    console.log(step3_optimized_resume)
    console.log('─'.repeat(40))

    console.log('\n✅ 测试完成！')
  } catch (error) {
    console.error('❌ 测试失败:', error)
  }
}

/**
 * 健康检查
 */
async function healthCheck() {
  console.log('检查服务健康状态...')

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/mvp/health`)
    const data = await response.json()

    if (data.status === 'ok') {
      console.log('✅ 服务运行正常')
      console.log(`   时间: ${data.timestamp}`)
      console.log(`   服务: ${data.service}\n`)
      return true
    } else {
      console.error('❌ 服务状态异常')
      return false
    }
  } catch (error) {
    console.error('❌ 无法连接到服务，请确保服务已启动')
    console.error(`   地址: ${API_BASE_URL}`)
    console.error(`   错误: ${error instanceof Error ? error.message : error}`)
    return false
  }
}

/**
 * 主函数
 */
async function main() {
  // 先进行健康检查
  const isHealthy = await healthCheck()

  if (!isHealthy) {
    console.log('\n请先启动服务:')
    console.log('  cd backend')
    console.log('  bun run dev')
    process.exit(1)
  }

  // 执行完整流程测试
  await testFullProcess()
}

// 运行测试
main()
