# 前后端共享简历策略规则

`resume-strategy.ts` 是唯一维护源。后端容器只包含 `backend`，前端部署根目录是 `frontend/Taro/reffo-taro`，因此两端不能在运行或构建时引用仓库根目录的文件。

修改规则后，在仓库根目录执行：

```sh
node shared/sync-resume-strategy.mjs --write
node shared/sync-resume-strategy.mjs --check
```

将源文件和两端 `src/shared/resume-strategy.ts` 生成文件一起提交。业务代码使用 `@/shared/resume-strategy`；部署直接使用各自目录中已提交的文件，不需要在容器中访问本目录。前后端 CI 检查生成文件是否与源文件一致，禁止手动维护不同版本。

`resume-completion.ts` 是相契简历结构、局部填写、整行编辑、旧稿适配和导出清理的唯一维护源。它仅依赖同目录的 `resume-strategy.ts` 指纹函数，不依赖 UI、网络或运行时 schema 库。

```sh
node shared/sync-resume-completion.mjs --write
node shared/sync-resume-completion.mjs --check
```

修改共享源后同步两端生成副本；不要直接编辑副本。接口保留规范 `【待完善：…】` 草稿投影，界面短标记仅存在编辑会话。结构校验与删除安全检查分离：已填/已移除节点不因旧事实锚点失效被拒绝；自动省略未填节点前须检查安全边界和保留锚点。测试在 `backend/src/shared/resume-completion.test.ts`，前端消费完全相同的生成源码，CI 分别检查同步一致性。

`resume-actions.ts` 是岗位要求、优化行动、写作位置、执行复核和结构调整清单的共享契约。行动计划及来源结构基准由服务端建立；客户端展示和定位当前版本的复核结果，不能通过填写、整行修改或上传 sidecar 自行认证资格或事实。

```sh
node shared/sync-resume-actions.mjs --write
node shared/sync-resume-actions.mjs --check
```

新生成请求声明 `x-reffo-completion-schema: resume-completion-v3`。填写状态、来源证明状态及结果确认状态分别保存；未填必要字段或未确认的结果不能因局部填写而自动放行。下载使用同一版本的共享安全投影，省略填写提示、未填分句及其依赖结果，保留编辑稿。
