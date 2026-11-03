# 发布任务的传输与执行

## 本机配置

默认 `~/.config/banji/deploy.json`，目录权限 700、文件 600。只保存连接元数据；不存密钥内容、口令或学生数据。已有配置先读，不覆盖。

```json
{
  "ssh_host": "ubuntu@服务器IP",
  "ssh_identity_file": "/绝对路径/现有私钥.pem",
  "ssh_known_hosts_file": "/绝对路径/已核验的known_hosts",
  "deploy_dir": "/home/ubuntu/banji/deploy",
  "release_root": "/home/ubuntu/banji-releases",
  "base_url": "https://工作台域名",
  "platform": "linux/amd64",
  "console_url": "已确认的腾讯云实例控制台地址",
  "build_args": {
    "DEBIAN_MIRROR": "http://mirrors.ustc.edu.cn",
    "NPM_REGISTRY": "https://registry.npmmirror.com"
  }
}
```

镜像源是当前实例已验证的设置；其他实例不要无条件沿用。主机密钥来自已验证的记录，不用 `StrictHostKeyChecking=no` 或直接信任临时 `ssh-keyscan` 结果。

## SSH 可用时

从配置取参数，以数组或安全 shell 引用构造命令，先做一次只读检查：

```sh
ssh -o BatchMode=yes -o ConnectTimeout=10 -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile=已核验文件 \
  -i 现有私钥 用户@主机 'sudo -n docker ps --format "{{.Names}} {{.Status}}"'
```

通过后经 stdin 执行任务包：

```sh
ssh <相同连接参数> 'sudo -n sh -s' < /tmp/banji-release-task/launch.sh
ssh <相同连接参数> 'sudo -n sh -s' < /tmp/banji-release-task/status.sh
```

构建在后台执行。按需读状态，不保持长时间阻塞的 SSH。若确需排查网络，使用可用的 `network-manager` 技能；历史网卡、源端口和出口 IP 不能作为固定参数。不改全局代理，不把 SSH 放开到所有来源。

## SSH 不通：腾讯云执行命令

1. 使用可用的 `ego-browser` 技能，执行 `ego-browser skill` 并读完整说明。一个发布任务用一个任务空间，打开配置的 `console_url`。
2. 确认实例名称和 IP。可使用现有快捷登录；需要用户验证时交接。
3. 实例 → 执行命令 → 新命令。当前实例的 `ubuntu` 无 Docker socket 权限，执行用户填 `root`；其他实例按已验证权限处理。不要启用执行记录上传 COS。
4. 读取本地 `launch.sh` 并粘贴进编辑器执行。命令几秒内返回只表示后台任务已启动，继续执行 `status.sh` 看真正阶段。
5. 避免反复输出整页或全部日志。完成后按浏览器技能 `task.finish({keep: []})`。

本次验证过的编辑器是 `.cm-content`（contenteditable），“AI 帮你生成命令”是另一个输入框。先用快照确认当前页面，页面变化后旧 ref 可能失效。可在 `ego-browser nodejs` 用 `node:fs/promises` 读取脚本，再 `page.keyboard.paste()`，避免多层引号。

底部按钮可能在视口外，先滚动目标再点击，同名按钮限定在 `[role="dialog"]` 内。动作失败后先看当前状态，不盲点第二次。执行结果要等“命令成功 / 命令失败 / 命令超时”；`ExitCode` 和“执行完成”按钮在运行中也会出现，不能据此判定结束。

不要输出完整 base64 脚本、原始浏览器事件、cookie 或凭据。

## 服务器下载 GitHub 失败

`prepare` 已保存逐文件校验过的 `source.tar.gz`：

- SSH 可用：上传到该 SHA 的发布目录，文件名 `source.tar.gz`，再执行 `launch.sh`。
- 仅控制台可用：确认后台任务已停止；按编号执行生成的 `upload-001.sh` 等分片，再执行 `upload-finish.sh`。分片各自写独立文件，可重试覆盖同一编号；合并后校验 SHA-256，成功再重跑 `launch.sh`。

分片仅含已提交代码，不能用于传数据库或运行配置。没有必要时不走分片。

## Compose 和数据库变更

脚本保留生产 Compose 及覆盖文件。若本次明确要求更新 Compose、Caddy、域名或环境变量，形成具体差异后按授权单独应用、验证；只发镜像不能代表这些配置已更新。

数据库结构或迁移变化不走自动回退脚本。按 `db-change` 技能核实备份与旧版兼容性，执行已确认的迁移方案。不要把旧数据库直接覆盖到可能已经有新记录的生产库。
