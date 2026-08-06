const esbuild = require('esbuild');
const { spawn, execFileSync } = require('child_process');

const watch = process.argv.includes('--watch');

const TAILWIND_ARGS = [
  '@tailwindcss/cli',
  '-i', 'webview-ui/src/tailwind.css',
  '-o', 'out/webview.css',
];

/** Runs the Tailwind CLI once (build) or spawns it in --watch mode, resolving/rejecting on exit. */
function runTailwind() {
  if (watch) {
    const child = spawn('npx', [...TAILWIND_ARGS, '--watch'], { stdio: 'inherit' });
    return child;
  }
  execFileSync('npx', [...TAILWIND_ARGS, '--minify'], { stdio: 'inherit' });
  return null;
}

/** Prints markers the `$esbuild-watch` problem matcher (see package.json) looks for. */
const watchLogPlugin = {
  name: 'watch-log',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        const where = location ? `${location.file}:${location.line}:${location.column}` : '';
        console.error(`${where}: error: ${text}`);
      }
      console.log('[watch] build finished');
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  outfile: 'out/extension.js',
  sourcemap: true,
  logLevel: 'info',
  plugins: watch ? [watchLogPlugin] : [],
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ['webview-ui/src/main.tsx'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  outfile: 'out/webview.js',
  sourcemap: true,
  logLevel: 'info',
  plugins: watch ? [watchLogPlugin] : [],
};

async function main() {
  if (watch) {
    const [extensionCtx, webviewCtx] = await Promise.all([
      esbuild.context(extensionConfig),
      esbuild.context(webviewConfig),
    ]);
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
    runTailwind();
    console.log('esbuild watching for changes...');
  } else {
    await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
    runTailwind();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
