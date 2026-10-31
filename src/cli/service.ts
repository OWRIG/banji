import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, networkInterfaces, platform } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// 本地部署：用 macOS 的 launchd 让网页服务开机自动启动、崩溃自动重启。

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const LABEL = "cc.banji.server"
const plistPath = join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`)

function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address
  }
  return null
}

function ensureEnv(lan: boolean) {
  const file = resolve(ROOT, ".env")
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : []
  const has = (k: string) => lines.some((l) => l.startsWith(`${k}=`) && l.slice(k.length + 1).trim() !== "")
  const set = (k: string, v: string) => {
    const i = lines.findIndex((l) => l.startsWith(`${k}=`))
    if (i >= 0) lines[i] = `${k}=${v}`
    else lines.push(`${k}=${v}`)
  }
  if (!has("BETTER_AUTH_SECRET")) set("BETTER_AUTH_SECRET", randomBytes(32).toString("base64"))
  if (!has("BETTER_AUTH_URL")) set("BETTER_AUTH_URL", "http://localhost:3000")
  if (!has("BACKUP_DIR")) set("BACKUP_DIR", join(homedir(), "Documents", "班级工作台备份"))
  set("HOST", lan ? "0.0.0.0" : "127.0.0.1")
  const ip = lanAddress()
  if (lan && ip && !has("TRUSTED_ORIGINS")) set("TRUSTED_ORIGINS", `http://${ip}:3000`)
  writeFileSync(file, `${lines.filter((l, i) => l !== "" || i < lines.length - 1).join("\n")}\n`)
  return { ip }
}

export async function installService(opts: { lan: boolean }) {
  if (platform() !== "darwin") throw new Error("目前只支持 macOS。其他系统请用 Docker 部署（见 deploy/DEPLOY.md）")
  const { ip } = ensureEnv(opts.lan)
  console.log("已准备 .env（登录密钥、备份目录）")

  if (!existsSync(resolve(ROOT, "dist/web/index.html"))) {
    console.log("正在打包网页……")
    execFileSync(resolve(ROOT, "node_modules/.bin/vite"), ["build"], { cwd: ROOT, stdio: "inherit" })
  }

  const logDir = join(homedir(), "Library/Logs/banji")
  mkdirSync(logDir, { recursive: true })
  mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true })
  const node = process.execPath
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${resolve(ROOT, "node_modules/tsx/dist/cli.mjs")}</string>
    <string>src/server/index.ts</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>NODE_ENV</key><string>production</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logDir}/server.log</string>
  <key>StandardErrorPath</key><string>${logDir}/server.log</string>
</dict>
</plist>
`
  if (existsSync(plistPath)) execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" })
  writeFileSync(plistPath, plist)
  execFileSync("launchctl", ["load", plistPath])
  console.log("\n✓ 已设置开机自动启动。浏览器打开：http://localhost:3000")
  if (opts.lan && ip)
    console.log(`  同一 Wi-Fi 下的手机打开：http://${ip}:3000（电脑的局域网地址变了需要重新运行本命令）`)
  console.log(`  日志：${logDir}/server.log`)
}

export async function uninstallService() {
  if (existsSync(plistPath)) {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" })
    rmSync(plistPath)
  }
  console.log("已取消开机自动启动。数据还在，随时可以重新运行 banji service install。")
}
