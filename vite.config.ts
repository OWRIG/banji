/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const apiPort = env.PORT ?? "3000"

  return {
    plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      // 固定用 127.0.0.1，端口被别的项目占用时会自动换一个，并在终端里打印实际地址
      host: "127.0.0.1",
      // 开发时 /api 请求转发给后端
      proxy: { "/api": `http://localhost:${apiPort}` },
    },
    build: { outDir: "dist/web" },
    test: {
      include: ["src/**/*.test.ts"],
      // 测试使用内存数据库，不影响 data/ 里的开发数据
      env: { DATABASE_URL: ":memory:" },
    },
  }
})
