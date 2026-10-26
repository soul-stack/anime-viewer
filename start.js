const { execFileSync } = require('child_process');
const electronPath = require('electron');
const path = require('path');

// 使用 execFileSync 启动 electron，完全清除 ELECTRON_RUN_AS_NODE
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

try {
  // 使用 execFileSync 启动子进程，继承干净的环境变量
  const child = require('child_process').spawn(electronPath, ['.'], {
    cwd: path.join(__dirname),
    env,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });
  child.unref();
} catch (e) {
  console.error('启动失败:', e.message);
}
process.exit(0);
