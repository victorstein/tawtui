import { renameSync, existsSync } from 'fs';
import { join } from 'path';
import solidTransformPlugin from '@opentui/solid/bun-plugin';

const arch = process.argv[2] || process.arch;
const target = `bun-darwin-${arch}` as const;

const external = [
  'class-transformer',
  'class-validator',
  '@nestjs/websockets',
  '@nestjs/microservices',
  '@nestjs/platform-express',
];

const suffix = `darwin-${arch}`;
console.log(`==> Building ${suffix}...`);

// Temporarily hide bunfig.toml so the compiled binary doesn't embed
// the preload directive (JSX is already transformed by the build plugin)
const bunfig = 'bunfig.toml';
const bunfigBak = 'bunfig.toml.bak';
const hasBunfig = existsSync(bunfig);
if (hasBunfig) renameSync(bunfig, bunfigBak);

try {
  const result = await Bun.build({
    entrypoints: ['src/main.ts'],
    outdir: 'dist',
    target,
    compile: true,
    plugins: [solidTransformPlugin],
    external,
  });

  if (!result.success) {
    console.error(`Build failed for ${suffix}:`);
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  renameSync(join('dist', 'main'), join('dist', `tawtui-${suffix}`));
  console.log(`    ✓ dist/tawtui-${suffix}`);
} finally {
  if (hasBunfig) renameSync(bunfigBak, bunfig);
}
