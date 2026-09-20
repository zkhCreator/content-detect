/**
 * Purpose: create a reproducible, self-contained Chrome/Edge Manifest V3 package.
 * Inputs: committed source; output: dist/chrome with generated icons and bundled local JS.
 * Boundaries: no environment/key embedding, source maps, remote code, or browser publishing.
 */
import { build } from 'esbuild';
import { mkdir, rm, copyFile, writeFile, readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = new URL('../dist/chrome/', import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(new URL('icons/', out), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: { background: 'src/browser/background.js', popup: 'src/ui/popup.js' },
  outdir: fileURLToPath(out), bundle: true, format: 'iife', target: ['chrome120'],
  legalComments: 'none', sourcemap: false, charset: 'utf8', minify: false,
});
await copyFile(new URL('../src/ui/popup.html', import.meta.url), new URL('popup.html', out));
await copyFile(new URL('../src/ui/popup.css', import.meta.url), new URL('popup.css', out));

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = {
  manifest_version: 3, name: 'OPC内容审查', version,
  description: '审查页面文字的快乐幽默、知识、共鸣与节奏，分析 AI 迹象和情绪，辅助判断账号匹配。仅在手动检查时读取内容。',
  minimum_chrome_version: '120',
  permissions: ['activeTab', 'scripting', 'storage'],
  host_permissions: ['https://api.typesafe.ai/*'],
  background: { service_worker: 'background.js' },
  action: { default_popup: 'popup.html', default_title: 'OPC内容审查' },
  icons: { 16: 'icons/16.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; connect-src https://api.typesafe.ai; base-uri 'none'" },
};
await writeFile(new URL('manifest.json', out), `${JSON.stringify(manifest, null, 2)}\n`);

function pngChunk(name, data) {
  const type = Buffer.from(name);
  const payload = Buffer.concat([type, data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const end = Buffer.alloc(4); end.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, payload, end]);
}
function icon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = x / size, ny = y / size;
    const radius = Math.hypot(nx - .48, ny - .53);
    const letter = radius > .19 && radius < .3 && !(nx > .53 && Math.abs(ny - .53) < .15);
    const arrow = nx > .57 && nx < .85 && ny > .15 && ny < .43 && (Math.abs(nx + ny - 1) < .045 || ny < .21 || nx > .79);
    const color = arrow ? [237, 129, 86, 255] : letter ? [248, 247, 243, 255] : [40, 45, 42, 255];
    raw.set(color, y * (size * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
for (const size of [16, 48, 128]) await writeFile(new URL(`icons/${size}.png`, out), icon(size));
console.log('Built dist/chrome (Chrome / Edge Manifest V3).');
