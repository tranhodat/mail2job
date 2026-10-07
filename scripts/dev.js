const { spawn } = require('node:child_process');
const { loadEnvFile } = require('node:process');

try {
  loadEnvFile('.env.local');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const child = spawn('npx', ['--yes', 'vercel@latest', 'dev', '--local'], {
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

child.on('error', error => {
  console.error('Could not start Vercel CLI:', error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
