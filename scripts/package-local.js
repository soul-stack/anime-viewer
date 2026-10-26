// Prepare an unpacked Windows release using the already installed Electron runtime.
// With no --build flag this script only checks inputs; it never replaces an existing release.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const projectDir = path.resolve(__dirname, '..');
const distDir = path.join(projectDir, 'dist');
const electronDist = path.join(projectDir, 'node_modules', 'electron', 'dist');
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

function filesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

function parseOptions(args) {
  let build = false;
  let output = path.join(distDir, `local-package-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--build') build = true;
    else if (args[index] === '--check') continue;
    else if (args[index] === '--output' && args[index + 1]) output = path.resolve(projectDir, args[++index]);
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  const relative = path.relative(distDir, output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Output must be a new directory inside this project\'s dist directory.');
  }
  if (fs.existsSync(output)) throw new Error(`Output already exists; choose a new directory: ${output}`);
  return { build, output };
}

function preflight(options) {
  if (process.platform !== 'win32') throw new Error('This local package helper requires Windows.');
  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
  for (const relative of ['main.js', 'preload.js', 'src/renderer/index.html', 'src/renderer/assets/hls.min.js', 'node_modules/electron/dist/electron.exe']) {
    if (!fs.existsSync(path.join(projectDir, relative))) throw new Error(`Missing required input: ${relative}`);
  }
  require.resolve('electron-builder');
  require.resolve('@electron/asar');
  for (const dependency of Object.keys(pkg.dependencies || {})) require.resolve(dependency, { paths: [projectDir] });
  const sourceFiles = ['main.js', 'preload.js'].map(file => path.join(projectDir, file))
    .concat(filesUnder(path.join(projectDir, 'src')), filesUnder(path.join(projectDir, 'resources')));
  const sources = new Map(sourceFiles.map(file => [path.relative(projectDir, file), hash(fs.readFileSync(file))]));
  const electronVersion = fs.readFileSync(path.join(electronDist, 'version'), 'utf8').trim();
  console.log(JSON.stringify({
    mode: options.build ? 'build' : 'check only',
    electronVersion,
    electronDist,
    sourceFiles: sources.size,
    dependencies: Object.keys(pkg.dependencies || {}),
    output: options.output,
    currentReleasePreserved: path.join(distDir, 'AniView'),
    downloads: 'Electron download, dependency rebuild, signing and installers disabled',
  }, null, 2));
  return { pkg, sources, electronVersion };
}

function verifyPackage(appDir, pkg, sources) {
  const asar = require('@electron/asar');
  const executable = path.join(appDir, `${pkg.build.productName}.exe`);
  const archive = path.join(appDir, 'resources', 'app.asar');
  if (!fs.existsSync(executable) || fs.statSync(executable).size < 1024 * 1024) throw new Error('Packaged executable is missing or incomplete.');
  if (!fs.existsSync(archive)) throw new Error('Packaged app.asar is missing.');

  for (const [relative, expectedHash] of sources) {
    if (hash(asar.extractFile(archive, relative)) !== expectedHash) throw new Error(`Packaged source does not match: ${relative}`);
  }
  const packagedManifest = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  for (const dependency of Object.keys(pkg.dependencies || {})) {
    if (packagedManifest.dependencies?.[dependency] !== pkg.dependencies[dependency]) throw new Error(`Dependency manifest mismatch: ${dependency}`);
    asar.extractFile(archive, path.join('node_modules', dependency, 'package.json'));
  }
  const entries = asar.listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, ''));
  if (entries.some(file => /^(?:\.repair-backup|tests|scripts|dist)(?:\/|$)/.test(file))) throw new Error('Development files leaked into app.asar.');

  // electron-builder may update the executable's ASAR integrity resource; compare the other runtime files.
  for (const file of filesUnder(electronDist)) {
    const relative = path.relative(electronDist, file);
    if (/^(?:electron\.exe|version|LICENSE[^\\/]*|resources[\\/])/.test(relative)) continue;
    const packaged = path.join(appDir, relative);
    if (!fs.existsSync(packaged) || hash(fs.readFileSync(packaged)) !== hash(fs.readFileSync(file))) {
      throw new Error(`Runtime file missing or damaged: ${relative}`);
    }
  }
  // Resolve dependencies inside the ASAR using Electron's actual module loader.
  const dependencyProbe = `
    const { createRequire } = require('node:module');
    const path = require('node:path');
    const archive = process.argv[1];
    const req = createRequire(path.join(archive, 'package.json'));
    const dependencies = Object.keys(req('./package.json').dependencies).map(name => {
      req(name);
      const entry = req.resolve(name);
      if (!entry.startsWith(archive + path.sep)) throw new Error('Dependency resolved outside package: ' + name);
      return { name, entry: path.relative(archive, entry) };
    });
    console.log(JSON.stringify({ dependencies, loadedModules: Object.keys(require.cache).length }));
  `;
  const probe = spawnSync(path.join(electronDist, 'electron.exe'), ['-e', dependencyProbe, archive], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  });
  if (probe.error || probe.status !== 0) throw new Error(`Packaged dependency load failed: ${probe.error?.message || probe.stderr}`);
  const dependencyReport = JSON.parse(probe.stdout.trim());
  return { executable, archive, sourceFilesVerified: sources.size, ...dependencyReport, archiveBytes: fs.statSync(archive).size, archiveSha256: hash(fs.readFileSync(archive)) };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const { pkg, sources, electronVersion } = preflight(options);
  if (!options.build) {
    console.log('Preflight passed. To package into a new directory: node scripts/package-local.js --build');
    return;
  }
  const { build, Platform, Arch } = require('electron-builder');
  await build({
    projectDir,
    targets: Platform.WINDOWS.createTarget('dir', Arch.x64),
    publish: 'never',
    config: {
      ...pkg.build,
      extends: null,
      electronDist,
      electronVersion,
      npmRebuild: false,
      nodeGypRebuild: false,
      downloadAlternateFFmpeg: false,
      forceCodeSigning: false,
      directories: { ...pkg.build.directories, output: options.output },
      win: { ...pkg.build.win, target: ['dir'], icon: null, signAndEditExecutable: false },
    },
  });
  const report = verifyPackage(path.join(options.output, 'win-unpacked'), pkg, sources);
  fs.writeFileSync(path.join(options.output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  console.log('Build verified. Existing releases have not been changed.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseOptions, preflight, verifyPackage };
