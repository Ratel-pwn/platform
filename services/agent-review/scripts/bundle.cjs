const esbuild = require('esbuild')

esbuild.build({
  entryPoints: { bundle: 'src/index.ts', check: 'src/check.ts' },
  outdir: 'bundle',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // Native ESM import preserves Pi's package assets and native dependencies.
  external: ['@earendil-works/pi-coding-agent', 'snappy'],
  logLevel: 'info'
}).catch(() => { process.exitCode = 1 })
