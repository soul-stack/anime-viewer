// Mimic Explorer launching the app: no tool-injected proxy variables and no previous cached catalogue.
const path = require('path');
const { spawn } = require('child_process');
const root = path.resolve(__dirname, '..');
const env = { ...process.env, ANIVIEW_SMOKE_FRESH: '1' };
for (const key of Object.keys(env)) {
  if (/proxy$/i.test(key) || ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED'].includes(key)) delete env[key];
}
if (process.argv.includes('--packaged')) env.ANIVIEW_SMOKE_APP_PATH = path.join(root, 'dist/AniView/resources/app.asar');
else delete env.ANIVIEW_SMOKE_APP_PATH;
const child = spawn(require('electron'), [path.join(root, 'tests/electron-smoke.cjs')], {
  cwd: root, env, windowsHide: true, stdio: 'inherit',
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
