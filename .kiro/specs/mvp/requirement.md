现在我针对当前项目reffo 给出了一个简单的 PRD @.kiro/specs/reffo/requirements.md 和 技术方案 @.kiro/specs/reffo/technical-design.md ，现在我需要给予这个逻辑搭建一个简单的MVP版本，现阶段能够让服务端调用AI的接口串起来即可，MVP需要达到的效果是：我输入一段markdown格式的简历，第一个agent帮我分析简历，然后给出结果，随后我输入一个JD，第二个agent帮我分析 JD与岗位的匹配度信息，输出结果，随后第三个Agent 针对JD与简历的匹配度，重新排列并编辑简历，最后输出新的简历markdown

这个流程需要使用elysia搭建的服务端能力跑通，页面使用一个简单的web页面用于展示结果即可，第一部需要用户输入md格式的简历，第二部需要用户输入md格式的jd，第三步骤展示根据jd和简历重排得到的新简历的md

先忽略以下功能：
1. 登录
2. 数据库（暂时使用浏览器storage实现）
3. 页面美观度