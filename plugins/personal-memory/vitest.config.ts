import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../../vitest.shared.ts'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  resolve: { alias: [
    { find: /^zod$/, replacement: fileURLToPath(new URL('../../packages/storage/storage-domain/node_modules/zod/index.js', import.meta.url)) },
    { find: /^react$/, replacement: fileURLToPath(new URL('../../packages/client/ui-settings-general/node_modules/react/index.js', import.meta.url)) },
    { find: /^react\/jsx-runtime$/, replacement: fileURLToPath(new URL('../../packages/client/ui-settings-general/node_modules/react/jsx-runtime.js', import.meta.url)) },
    { find: /^react\/jsx-dev-runtime$/, replacement: fileURLToPath(new URL('../../packages/client/ui-settings-general/node_modules/react/jsx-dev-runtime.js', import.meta.url)) },
  ] },
  test: { execArgv: vitestExecArgv, include: ['plugins/personal-memory/tests/**/*.spec.{ts,tsx}'] },
})
