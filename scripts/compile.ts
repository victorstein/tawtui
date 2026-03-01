import { renameSync } from 'fs';
import { join } from 'path';
import solidTransformPlugin from '@opentui/solid/bun-plugin';

const external = [
  'class-transformer',
  'class-validator',
  '@nestjs/websockets',
  '@nestjs/microservices',
  '@nestjs/platform-express',
];

console.log('==> Building darwin-arm64...');

const result = await Bun.build({
  entrypoints: ['src/main.ts'],
  outdir: 'dist',
  target: 'bun-darwin-arm64',
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
  },
  plugins: [solidTransformPlugin],
  external,
});

if (!result.success) {
  console.error('Build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

renameSync(join('dist', 'main'), join('dist', 'tawtui-darwin-arm64'));
console.log('    ✓ dist/tawtui-darwin-arm64');
