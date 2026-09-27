# 前后端共享简历策略规则

`resume-strategy.ts` 是唯一维护源。后端容器只包含 `backend`，前端部署根目录是 `frontend/Taro/reffo-taro`，因此两端不能在运行或构建时引用仓库根目录的文件。

修改规则后，在仓库根目录执行：

```sh
node shared/sync-resume-strategy.mjs --write
node shared/sync-resume-strategy.mjs --check
```

将源文件和两端 `src/shared/resume-strategy.ts` 生成文件一起提交。业务代码使用 `@/shared/resume-strategy`；部署直接使用各自目录中已提交的文件，不需要在容器中访问本目录。前后端 CI 检查生成文件是否与源文件一致，禁止手动维护不同版本。
