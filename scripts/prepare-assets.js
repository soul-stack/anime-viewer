const fs = require('node:fs');
const path = require('node:path');

// Generated third-party files stay out of Git. Recreate them after a fresh clone
// and keep the upstream license beside the browser bundle in packaged builds.
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'src', 'renderer', 'assets');
const hls = path.join(root, 'node_modules', 'hls.js');
fs.mkdirSync(destination, { recursive: true });
fs.copyFileSync(path.join(hls, 'dist', 'hls.min.js'), path.join(destination, 'hls.min.js'));
fs.copyFileSync(path.join(hls, 'LICENSE'), path.join(destination, 'hls.LICENSE.txt'));
console.log('Prepared HLS.js browser bundle and upstream license.');
