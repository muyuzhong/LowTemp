import { builtinModules } from 'node:module';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');

const NODE_EXTERNALS = new Set([
  ...builtinModules,
  ...builtinModules.map(name => `node:${name}`),
]);

const SHARED_UI_EXTERNALS = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'motion/react',
]);

async function inlineCssIntoUi() {
  const files = await readdir(dist);
  const cssFiles = files.filter(name => name.endsWith('.css')).sort();
  if (cssFiles.length === 0) {
    throw new Error('Expected built CSS asset for lowtemp UI, but none was emitted');
  }
  const cssParts = [];
  for (const name of cssFiles) {
    const filePath = resolve(dist, name);
    cssParts.push(await readFile(filePath, 'utf8'));
    await rm(filePath);
  }
  const css = cssParts.join('\n');
  const injector = [
    '',
    ';(function(){',
    '  if (typeof document === "undefined") return;',
    '  var id = "featherlog-plugin-style-lowtemp";',
    '  var el = document.getElementById(id);',
    '  if (!el) {',
    '    el = document.createElement("style");',
    '    el.id = id;',
    '    document.head.appendChild(el);',
    '  }',
    `  el.textContent = ${JSON.stringify(css)};`,
    '})();',
    '',
  ].join('\n');
  const uiPath = resolve(dist, 'ui.js');
  const current = await readFile(uiPath, 'utf8');
  await writeFile(uiPath, current + injector, 'utf8');
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  configFile: false,
  logLevel: 'warn',
  mode: 'production',
  build: {
    outDir: dist,
    emptyOutDir: false,
    minify: false,
    target: 'node22',
    lib: {
      entry: resolve(root, 'src/main/node.ts'),
      formats: ['es'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: id => NODE_EXTERNALS.has(id),
    },
  },
});

await build({
  configFile: false,
  logLevel: 'warn',
  mode: 'production',
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    outDir: dist,
    emptyOutDir: false,
    minify: false,
    cssCodeSplit: false,
    target: 'chrome130',
    lib: {
      entry: resolve(root, 'src/ui/index.tsx'),
      formats: ['es'],
      fileName: () => 'ui.js',
    },
    rollupOptions: {
      external: id => SHARED_UI_EXTERNALS.has(id),
    },
  },
});

await inlineCssIntoUi();
await copyFile(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'));

const uiSource = await readFile(resolve(dist, 'ui.js'), 'utf8');
for (const match of uiSource.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
  if (!SHARED_UI_EXTERNALS.has(match[1])) {
    throw new Error(`Unexpected external import in ui.js: ${match[1]}`);
  }
}

console.log('Built external Featherlog plugin into', dist);
