import { spawnSync } from 'node:child_process';

const candidates = process.platform === 'win32'
  ? [
      { command: 'python', args: [] },
      { command: 'py', args: ['-3'] },
      { command: 'python3', args: [] },
    ]
  : [
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
    ];

const userArgs = process.argv.slice(2);

for (const candidate of candidates) {
  const result = spawnSync(candidate.command, [...candidate.args, ...userArgs], {
    stdio: 'inherit',
    shell: false,
  });

  if (!result.error) {
    process.exit(result.status ?? 0);
  }

  if (result.error.code !== 'ENOENT') {
    throw result.error;
  }
}

console.error('Unable to find a Python interpreter. Tried:', candidates.map((candidate) => candidate.command).join(', '));
process.exit(1);
