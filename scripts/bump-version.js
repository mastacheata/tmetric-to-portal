import fs from 'node:fs';
import path from 'node:path';

const USERSCRIPT_PATH = path.resolve('tmetric-portal-sync.user.js');

function bumpVersion() {
  if (!fs.existsSync(USERSCRIPT_PATH)) {
    console.error('tmetric-portal-sync.user.js not found');
    process.exit(1);
  }

  let content = fs.readFileSync(USERSCRIPT_PATH, 'utf-8');
  const versionRegex = /\/\/\s*@version\s+([0-9]+)\.([0-9]+)\.([0-9]+)/;
  const match = content.match(versionRegex);

  if (!match) {
    console.error('Could not find // @version X.Y.Z in userscript header');
    process.exit(1);
  }

  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  const patch = parseInt(match[3], 10) + 1;

  const newVersion = `${major}.${minor}.${patch}`;
  content = content.replace(versionRegex, `// @version      ${newVersion}`);

  fs.writeFileSync(USERSCRIPT_PATH, content, 'utf-8');

  console.log(newVersion);
  return newVersion;
}

bumpVersion();
