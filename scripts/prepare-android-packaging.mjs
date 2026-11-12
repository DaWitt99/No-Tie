import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gradleFile = resolve(projectRoot, 'src-tauri/gen/android/app/build.gradle.kts');

let gradle;
try {
  gradle = await readFile(gradleFile, 'utf8');
} catch (error) {
  if (error.code === 'ENOENT') {
    console.log('Android project is not initialized; native packaging adjustment skipped.');
    process.exit(0);
  }
  throw error;
}

const setting = /(useLegacyPackaging\s*=\s*)(true|false)/g;
const matches = [...gradle.matchAll(setting)];
if (matches.length !== 1) {
  throw new Error(`Expected one useLegacyPackaging setting in ${gradleFile}, found ${matches.length}.`);
}

if (matches[0][2] !== 'false') {
  gradle = gradle.replace(setting, '$1false');
  await writeFile(gradleFile, gradle);
}
console.log('Android native libraries will be packaged uncompressed, matching the known-good tablet APK.');
