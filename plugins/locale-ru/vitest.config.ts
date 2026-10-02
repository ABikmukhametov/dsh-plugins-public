/** Source-level package tests use the DSH native service implementations. */
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../../vitest.shared.ts'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: { execArgv: vitestExecArgv, include: ['plugins/locale-ru/tests/**/*.spec.ts'] },
})
