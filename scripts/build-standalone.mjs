#!/usr/bin/env node
/**
 * 打包「双击即玩」的单文件 HTML。
 *
 * 浏览器不允许 file:// 页面加载 ES Module（import 会被 CORS 拦截），所以这里用
 * esbuild 把 src/main.js（连同本地 vendored 的 three 与 addons）打成普通 IIFE，
 * 再把 styles.css 和脚本一起内联进 index.html，生成一个零依赖、可离线双击打开的
 * 单文件 HTML。
 *
 * 用法：
 *   node scripts/build-standalone.mjs                 # -> dist/sandstrike.html
 *   node scripts/build-standalone.mjs --out=demo.html
 *   node scripts/build-standalone.mjs --no-minify     # 方便调试/定位问题
 *
 * 产物固定写到 dist/（构建产物目录，不进源码树、已 gitignore），不再和
 * index.html / src 放在一起。验证：node scripts/verify-standalone.mjs。
 *
 * 注意：单文件版本不读取 index.html 的 importmap，也不发起任何网络请求。
 */
import { build, transform } from 'esbuild';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const outArg = argv.find((arg) => arg.startsWith('--out='))?.slice('--out='.length);
const OUT = resolve(ROOT, outArg || 'dist/sandstrike.html');
const MINIFY = !argv.includes('--no-minify');

const fail = (message) => {
  console.error(`\n  [build-standalone] ${message}\n`);
  process.exit(1);
};

const readText = async (path) => {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    fail(`无法读取 ${path}：${error.message}`);
  }
};

const replaceOnce = (html, search, replacement, label) => {
  const index = html.indexOf(search);
  if (index === -1) fail(`index.html 中找不到${label}，构建脚本需要同步更新。`);
  if (html.indexOf(search, index + search.length) !== -1) fail(`index.html 中${label}出现多次，构建脚本需要同步更新。`);
  return html.slice(0, index) + replacement + html.slice(index + search.length);
};

const escapeForInlineScript = (code) => {
  // 内联 classic script 里只要出现 </script 就会提前结束标签；用等价写法转义。
  const unsafe = code.match(/<\/script|<!--|<script/gi);
  if (!unsafe) return code;
  console.warn(`  [build-standalone] 转义内联脚本中的 ${unsafe.length} 处 HTML 敏感序列`);
  return code
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--')
    .replace(/<script/gi, '<\\u0073cript');
};

console.log('\n  SANDSTRIKE // 单文件 HTML 构建');

// ---------------------------------------------------------------------------
// 1. JS：ES Module -> IIFE（three 通过 tsconfig.build.json 的 paths 指向 vendor）
// ---------------------------------------------------------------------------
let jsOutput;
try {
  jsOutput = await build({
    absWorkingDir: ROOT,
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100', 'edge100', 'firefox100', 'safari15'],
    tsconfig: resolve(ROOT, 'tsconfig.build.json'),
    write: false,
    minify: MINIFY,
    legalComments: 'none',
    logLevel: 'silent',
  });
} catch (error) {
  fail(`JS 打包失败：\n${error.message}`);
}
const js = escapeForInlineScript(jsOutput.outputFiles[0].text);
if (!js.trim()) fail('JS 打包结果为空。');

// ---------------------------------------------------------------------------
// 2. CSS：可安全压缩；url() 只有 data URI，不会引入外部依赖
// ---------------------------------------------------------------------------
const cssRaw = await readText(resolve(ROOT, 'styles.css'));
let css = cssRaw;
if (MINIFY) {
  try {
    css = (await transform(cssRaw, { loader: 'css', minify: true })).code;
  } catch (error) {
    console.warn(`  [build-standalone] CSS 压缩失败，回退原文：${error.message}`);
    css = cssRaw;
  }
}
if (/<\/style/i.test(css)) fail('CSS 中出现 </style，无法直接内联。');

// ---------------------------------------------------------------------------
// 3. HTML：内联样式与脚本，去掉 importmap / 外部 module 请求
// ---------------------------------------------------------------------------
let html = await readText(resolve(ROOT, 'index.html'));

html = replaceOnce(
  html,
  '<link rel="stylesheet" href="./styles.css" />',
  `<style>\n${css}\n</style>`,
  '样式表 <link>',
);
html = replaceOnce(
  html,
  '<script type="module" src="./src/main.js"></script>',
  `<script>\n${js}\n</script>`,
  '入口 <script type="module">',
);
html = html.replace(/[ \t]*<script type="importmap">[\s\S]*?<\/script>\s*\n?/, '');
if (html.includes('type="importmap"') || html.includes('type="module"')) {
  fail('内联后仍残留 importmap / module 脚本，构建结果无法在 file:// 下运行。');
}
if (html.includes('./styles.css') || html.includes('./src/main.js')) {
  fail('内联后仍残留对外部文件的引用。');
}

html = html.replace(
  '<!DOCTYPE html>',
  '<!DOCTYPE html>\n<!-- 由 scripts/build-standalone.mjs 生成：单文件、可离线双击运行。源文件在 index.html / src / styles.css，产物在 dist/。 -->',
);

// ---------------------------------------------------------------------------
// 4. 写出
// ---------------------------------------------------------------------------
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html, 'utf8');

const sizeMB = (await stat(OUT)).size / 1024 / 1024;
console.log(`  ├ JS   ${(js.length / 1024 / 1024).toFixed(2)} MB${MINIFY ? '（已压缩）' : ''}`);
console.log(`  ├ CSS  ${(css.length / 1024).toFixed(1)} KB${MINIFY ? '（已压缩）' : ''}`);
console.log(`  └ HTML ${OUT}`);
console.log(`  ✓ 完成：${sizeMB.toFixed(2)} MB，双击即可用 Chrome / Edge 打开\n`);
