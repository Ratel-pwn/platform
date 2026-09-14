// Copyright © 2026 Hardcore Engineering Inc.
// Standalone component regression: node plugins/print-resources/src/__tests__/DOCXViewer.test.cjs
// Resolve existing svelte, svelte-preprocess, esbuild and playwright packages through NODE_PATH.
// CHROMIUM_PATH can select an existing local browser. No server or production build is needed.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { compile, preprocess } = require('svelte/compiler')
const sveltePreprocess = require('svelte-preprocess')
const { build } = require('esbuild')
const { chromium } = require('playwright')

const filename = path.resolve(__dirname, '../components/DOCXViewer.svelte')
const stubs = {
  Button: '<script>export let label</script><button on:click>{label}</button>',
  Label: '<script>export let label</script><span>{label}</span>',
  Spinner: '<span data-testid="spinner">Loading</span>',
  EmbeddedPDF: '<script>export let src; export let name</script><div data-viewer="pdf" data-src={src} data-name={name}></div>',
  EmbeddedHTML: '<script>export let src; export let name; export let css</script><div data-viewer="html" data-src={src} data-name={name} data-css={css}></div>'
}

async function bundleComponent () {
  const processed = await preprocess(fs.readFileSync(filename, 'utf8'), sveltePreprocess({
    typescript: { tsconfigFile: false },
    scss: { silenceDeprecations: ['legacy-js-api'] }
  }), { filename })
  const component = compile(processed.code, { filename, generate: 'dom' }).js.code
  const modules = {
    component,
    '@hcengineering/platform': 'export const getMetadata = () => "workspace-token"',
    '@hcengineering/analytics': 'export const Analytics = { handleError: error => window.errors.push(error.message) }',
    '@hcengineering/print': `
      export default { string: { Retry: 'Retry' } }
      export function convertForPreview(file, token, signal) {
        return new Promise((resolve, reject) => window.pending.push({file, token, signal, resolve, reject}))
      }
    `,
    '@hcengineering/presentation': `
      export default { metadata: { Token: 'token' }, string: { FailedToPreview: 'Failed to preview', DownloadOriginal: 'Download original' } }
      export const getFileUrl = (id, name) => '/blob/' + id + '/' + encodeURIComponent(name)
    `,
    '@hcengineering/ui': `
      import { writable } from 'svelte/store'
      export const themeStore = writable({dark: false})
      ${Object.keys(stubs).map(name => `export { default as ${name} } from 'stub:${name}'`).join('\n')}
    `
  }
  for (const [name, source] of Object.entries(stubs)) {
    modules[`stub:${name}`] = compile(source, { filename: `${name}.svelte`, generate: 'dom' }).js.code
  }
  const result = await build({
    stdin: {
      contents: `
        import Viewer from 'component'
        import { tick } from 'svelte'
        window.pending = []
        window.errors = []
        let viewer
        window.mount = (value, name = 'Original.DOCX') => {
          viewer = new Viewer({ target: document.body, props: {value, name, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'} })
        }
        window.switchSource = value => viewer.$set({value})
        window.dispose = () => viewer.$destroy()
        window.flush = async () => { await tick(); await tick() }
      `,
      resolveDir: __dirname
    },
    bundle: true,
    write: false,
    format: 'iife',
    tsconfigRaw: {},
    nodePaths: (process.env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean),
    plugins: [{
      name: 'native-component-mocks',
      setup (builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (Object.hasOwn(modules, args.path)) return { path: args.path, namespace: 'mock' }
        })
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: modules[args.path], resolveDir: __dirname }))
      }
    }]
  })
  return result.outputFiles[0].text
}

async function main () {
  const bundle = await bundleComponent()
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH })
  const tests = []
  async function test (name, run) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.setContent('<!doctype html><html><body></body></html>')
      await page.addScriptTag({ content: bundle })
      await page.evaluate(async () => { window.mount('source-a'); await window.flush() })
      await run(page)
      assert.deepEqual(errors, [])
      tests.push(name)
      console.log(`PASS ${name}`)
    } finally {
      await page.close()
    }
  }

  try {
    await test('loading renders before a converted URL exists', async page => {
      assert.equal(await page.locator('[data-testid="spinner"]').count(), 1)
      assert.equal(await page.locator('[data-viewer]').count(), 0)
      assert.deepEqual(await page.evaluate(() => window.pending.map(({file, token, signal}) => ({file, token, aborted: signal.aborted}))),
        [{ file: 'source-a', token: 'workspace-token', aborted: false }])
    })

    await test('PDF uses a .pdf filename and HTML retains legacy styling', async page => {
      await page.evaluate(async () => { window.pending[0].resolve({id: 'pdf-a', contentType: 'application/pdf'}); await window.flush() })
      assert.equal(await page.locator('[data-viewer="pdf"]').getAttribute('data-name'), 'Original.pdf')
      assert.equal(await page.locator('[data-viewer="pdf"]').getAttribute('data-src'), '/blob/pdf-a/Original.pdf')
      await page.evaluate(async () => { window.switchSource('source-b'); await window.flush(); window.pending[1].resolve({id: 'html-b', contentType: 'text/html'}); await window.flush() })
      assert.equal(await page.locator('[data-viewer="html"]').getAttribute('data-name'), 'Original.DOCX')
      assert.match(await page.locator('[data-viewer="html"]').getAttribute('data-css'), /text-editor-table-header-color/)
    })

    await test('switching aborts the old request and ignores a late success', async page => {
      await page.evaluate(async () => { window.switchSource('source-b'); await window.flush() })
      assert.equal(await page.evaluate(() => window.pending[0].signal.aborted), true)
      await page.evaluate(async () => { window.pending[1].resolve({id: 'new-pdf', contentType: 'application/pdf'}); await window.flush(); window.pending[0].resolve({id: 'old-html', contentType: 'text/html'}); await window.flush() })
      assert.equal(await page.locator('[data-viewer="pdf"]').getAttribute('data-src'), '/blob/new-pdf/Original.pdf')
      assert.equal(await page.locator('[data-viewer="html"]').count(), 0)
    })

    await test('a stale rejection leaves the new request loading without showing errors', async page => {
      await page.evaluate(async () => { window.switchSource('source-b'); await window.flush(); window.pending[0].reject(new Error('stale failure')); await window.flush() })
      assert.equal(await page.locator('[data-testid="spinner"]').count(), 1)
      assert.equal(await page.getByText('Failed to preview').count(), 0)
      assert.deepEqual(await page.evaluate(() => window.errors), [])
    })

    await test('failure offers original DOCX download and retry recovers', async page => {
      await page.evaluate(async () => { window.pending[0].reject(new Error('converter unavailable')); await window.flush() })
      assert.equal(await page.getByText('Failed to preview').count(), 1)
      assert.equal(await page.locator('a').getAttribute('download'), 'Original.DOCX')
      assert.equal(await page.locator('a').getAttribute('href'), '/blob/source-a/Original.DOCX')
      await page.getByRole('button', {name: 'Retry', exact: true}).click()
      assert.equal(await page.locator('[data-testid="spinner"]').count(), 1)
      assert.equal(await page.getByText('Failed to preview').count(), 0)
      await page.evaluate(async () => { window.pending[1].resolve({id: 'retry-pdf', contentType: 'application/pdf'}); await window.flush() })
      assert.equal(await page.locator('[data-viewer="pdf"]').count(), 1)
    })

    await test('destroy aborts conversion and ignores late rejection', async page => {
      await page.evaluate(async () => { window.dispose(); window.pending[0].reject(new Error('disposed failure')); await window.flush() })
      assert.equal(await page.evaluate(() => window.pending[0].signal.aborted), true)
      assert.equal(await page.locator('[data-testid="spinner"], [data-viewer]').count(), 0)
      assert.deepEqual(await page.evaluate(() => window.errors), [])
    })
    console.log(`DOCXViewer lifecycle: ${tests.length} passed`)
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
