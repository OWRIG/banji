---
name: deploy-cloud
description: 发布或升级班级工作台，完成提交校验、备份、镜像切换、线上验收和故障回退。用户说“发布班级工作台”“提交并部署”“更新线上”时使用；也支持首次部署和数据迁移。
---

# 班级工作台发布

让用户一句“发布班级工作台”即可完成已授权的发布。复用现有实例、配置和域名；不要把已授权的提交、备份、更新拆成反复确认。

## 选择流程

- **已有实例升级**：读本机 `~/.config/banji/deploy.json`，按下文执行。缺失时先查现有环境和用户引用的部署记录，确实缺少必要信息时才问用户。引用的 Codex chat 必须先 `read_thread`。
- **首次部署、换服务器、迁移数据**：读 [deploy/DEPLOY.md](../../../deploy/DEPLOY.md)，确认目标、备案和迁移范围后执行。
- **数据库结构或迁移有变化**：涉及已有表时先读 [db-change](../db-change/SKILL.md)。自动脚本会拒绝这类变化；按已确认的迁移兼容性制定发布和回退步骤，不能绕过检查或自动覆盖数据库。

## 已有实例升级

1. 确认工作区、本次范围和目标提交。按用户授权提交、推送相关文件，不混入无关改动或服务器配置。
2. 运行 `pnpm check`；同一会话同一份代码已全部通过时复用证据，改过代码则重跑。Dockerfile / Compose 有变化时，先本地构建目标架构的镜像。
3. 生成固定版本的任务包：

   ```sh
   python3 -B .agents/skills/deploy-cloud/scripts/release.py prepare \
     --revision HEAD --output /tmp/banji-release-task
   ```

   可用 `--profile /绝对路径/deploy.json` 指定实例。要求干净工作区，并逐文件验证 GitHub 归档与本地提交一致；适用于当前公开 GitHub 仓库。产物留在仓库外。
4. 按 [传输与执行](references/transport.md) 执行生成的 `launch.sh`。SSH 只做一次有界检查；登录前关闭或超时即转腾讯云执行命令，不反复调整代理、尝试历史源端口或扩大 SSH 公网开放范围。
5. 用生成的 `status.sh` 看阶段和最后少量日志；每次等待不超过 60 秒。看到 `COMPLETE` 后，从本机确认公网 `/api/health` 可访问。不要读取学生名单来验证发布。
6. 汇报线上链接、提交 SHA、检查结果和备份情况，按浏览器技能收尾。

脚本不提交或推送代码。它校验归档，在独立目录构建，保持旧应用运行，切换前备份；只更新一个 `app`，沿用现有 Compose、覆盖文件和 Caddy。它检测版本和配置漂移，同一版本只验收不重启，并验证健康状态、HTTPS、401 登录保护、线上首页与容器一致以及前端入口可下载。切换后失败且结构兼容时恢复原镜像，再验证原服务；不会回滚数据库。

源码保存在 `release_root/<完整SHA>/source`，状态和上一镜像记录在同目录。`deploy_dir` 保留生产 Compose 和持久数据。以后按容器的版本标签识别线上版本，不从原源码目录的 Git 状态推断。

## 失败处理

- `FAILED`：未切换；修复原因后可重跑同一任务。下载失败用传输文档的上传备用路径。
- `ROLLED_BACK`：旧服务已恢复，本次发布未成功；先修复再发新版本。
- `ROLLBACK_FAILED`：检查当前服务和具体错误，报告需要处理的事项，禁止盲目重复切换。
- 同一原因连续失败两次后停止自动重试；有新证据或修复后再继续。
- 浏览器登录、用户接管或系统权限提示，按 `ego-browser` 技能交接，不新建空间绕过。

## 维护

修改脚本后运行隔离测试和项目检查：

```sh
python3 -B -m unittest discover -s .agents/skills/deploy-cloud/scripts -p 'test_*.py' -v
pnpm check
```

测试替代 Docker 和网络响应，不操作生产环境。真实发布仍以线上 `COMPLETE` 和公网验证为准。

不要把 `.env`、密钥、数据库内容、完整 Docker inspect / Compose config 输出到聊天或云端执行记录。主机与私钥路径放本机配置，不提交到公开仓库。部署配置示例见 [传输与执行](references/transport.md)。
