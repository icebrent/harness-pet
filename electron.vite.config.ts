import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          main: 'src/main/main.ts',
          'harness-worker': 'src/main/harness-worker.ts',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: 'src/renderer/index.html',
      },
    },
  },
})
