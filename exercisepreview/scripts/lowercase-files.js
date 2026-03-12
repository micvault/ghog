#!/usr/bin/env node
// Lowercase filenames recursively under a given directory (safe).
// Usage:
//   node scripts/lowercase-files.js <root-path> [--dry-run]

const fs = require('fs').promises;
const path = require('path');

const root = process.argv[2] || process.cwd();
const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-n');

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full);
    }
    if (e.isFile()) {
      // First try to remove numeric suffixes like _1 if safe
      const handled = await processSuffix(dir, e.name);
      if (!handled) await processFile(dir, e.name);
    }
  }
}

// If a filename ends with _<number> before the extension, try to remove that
// suffix when safe: if target (without suffix) does not exist, rename; if it
// exists and is identical, remove the suffixed file; otherwise leave as-is.
async function processSuffix(dir, name) {
  const m = name.match(/^(.+)_([0-9]+)(\.[^.]*)$/);
  if (!m) return false;
  const origPath = path.join(dir, name);
  const targetName = `${m[1]}${m[3]}`;
  const targetPath = path.join(dir, targetName);

  if (await exists(targetPath)) {
    try {
      const [srcBuf, tgtBuf] = await Promise.all([fs.readFile(origPath), fs.readFile(targetPath)]);
      if (Buffer.compare(srcBuf, tgtBuf) === 0) {
        if (dryRun) {
          console.log(`[dry-run] Removing duplicate suffix file: ${origPath} (identical to ${targetPath})`);
        } else {
          await fs.unlink(origPath);
          console.log(`Removed duplicate suffix file: ${origPath}`);
        }
        return true;
      }
    } catch (e) {
      // if reading fails, don't touch
      return false;
    }
    // target exists and is different -> leave suffixed file alone
    return false;
  }

  // target does not exist -> rename suffixed file to target
  if (dryRun) {
    console.log(`[dry-run] ${origPath} -> ${targetPath}`);
    return true;
  }
  const tempName = `${name}.tmprename.${Date.now()}.${Math.floor(Math.random() * 10000)}`;
  const tempPath = path.join(dir, tempName);
  try {
    await fs.rename(origPath, tempPath);
    await fs.rename(tempPath, targetPath);
    console.log(`Renamed (removed suffix): ${origPath} -> ${targetPath}`);
    return true;
  } catch (err) {
    console.error(`Failed to remove suffix for ${origPath}:`, err.message);
    try { if (await exists(tempPath)) await fs.rename(tempPath, origPath); } catch (e) {}
    return false;
  }
}

async function processFile(dir, name) {
  const origPath = path.join(dir, name);
  const lowerName = name.toLowerCase();
  if (name === lowerName) return;

  const targetPath = path.join(dir, lowerName);

  if (await exists(targetPath)) {
    // If target exists: if files are identical, remove the source duplicate;
    // otherwise overwrite the existing target with the source (safe rename via temp file).
    try {
      const [srcBuf, tgtBuf] = await Promise.all([fs.readFile(origPath), fs.readFile(targetPath)]);
      if (Buffer.compare(srcBuf, tgtBuf) === 0) {
        if (dryRun) {
          console.log(`[dry-run] Removing duplicate: ${origPath} (identical to ${targetPath})`);
        } else {
          await fs.unlink(origPath);
          console.log(`Removed duplicate: ${origPath}`);
        }
        return;
      }
    } catch (e) {
      // If reading fails for some reason, fall through to overwrite behavior.
    }
  }

  if (dryRun) {
    console.log(`[dry-run] ${origPath} -> ${targetPath}`);
    return;
  }

  const tempName = `${name}.tmprename.${Date.now()}.${Math.floor(Math.random() * 10000)}`;
  const tempPath = path.join(dir, tempName);
  try {
    // move source to a temp name first to avoid partial states
    await fs.rename(origPath, tempPath);

    // If target exists, remove it so we can move temp into its place
    if (await exists(targetPath)) {
      try {
        await fs.unlink(targetPath);
      } catch (e) {
        // if we failed to remove target, try to revert and throw
        if (await exists(tempPath)) {
          await fs.rename(tempPath, origPath);
        }
        throw e;
      }
    }

    await fs.rename(tempPath, targetPath);
    console.log(`Renamed: ${origPath} -> ${targetPath}`);
  } catch (err) {
    console.error(`Failed to rename ${origPath} -> ${targetPath}:`, err.message);
    // attempt to revert temp if present
    try {
      if (await exists(tempPath)) await fs.rename(tempPath, origPath);
    } catch (e) {}
  }
}

async function main() {
  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
      console.error('Root path must be a directory');
      process.exit(1);
    }
  } catch (err) {
    console.error('Cannot access root path:', err.message);
    process.exit(1);
  }

  console.log(`Starting${dryRun ? ' (dry-run)' : ''} at: ${root}`);
  await walk(root);
  console.log('Done');
}

main().catch(err => { console.error(err); process.exit(1); });
