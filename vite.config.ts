import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/copilotkit': {
        target: process.env.BFF_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
      '/api/llm': {
        target: process.env.BFF_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  test: {
    // 独立验证工具使用自己的测试命令，正式项目只收集自己的测试。
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'electron/**/*.{test,spec}.ts'],
    globals: true,
    environment: 'node',
  },
})
