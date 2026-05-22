const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildValidationIssue,
  createInstallTargetAdapter,
} = require('./helpers');

const COMPILED_PLUGIN_DIST_DIR = path.join('.opencode', 'dist');
const REQUIRED_COMPILED_RELATIVE_PATHS = Object.freeze([
  path.join(COMPILED_PLUGIN_DIST_DIR, 'index.js'),
  path.join(COMPILED_PLUGIN_DIST_DIR, 'plugins'),
  path.join(COMPILED_PLUGIN_DIST_DIR, 'tools'),
]);
const BUILD_COMMAND_HINT = 'node scripts/build-opencode.js (or: npm run build:opencode)';

function defaultValidateOpencodeHome(input = {}) {
  if (!input.homeDir && !os.homedir()) {
    return [
      buildValidationIssue(
        'error',
        'missing-home-dir',
        'homeDir is required for home install targets'
      ),
    ];
  }

  if (!input.repoRoot) {
    return [];
  }

  const missingPaths = REQUIRED_COMPILED_RELATIVE_PATHS
    .map(relativePath => ({
      relativePath,
      absolutePath: path.join(input.repoRoot, relativePath),
    }))
    .filter(entry => !fs.existsSync(entry.absolutePath));

  if (missingPaths.length > 0) {
    const missingList = missingPaths.map(entry => entry.relativePath).join(', ');
    return [
      buildValidationIssue(
        'error',
        'opencode-plugin-not-built',
        'OpenCode install requires the compiled plugin payload under '
          + `${COMPILED_PLUGIN_DIST_DIR}, but the following artefact(s) were not found: `
          + `${missingList}. Run ${BUILD_COMMAND_HINT} from the repo root before `
          + 're-running the installer.',
        {
          missingPaths: missingPaths.map(entry => entry.absolutePath),
          missingRelativePaths: missingPaths.map(entry => entry.relativePath),
        }
      ),
    ];
  }

  return [];
}

module.exports = createInstallTargetAdapter({
  id: 'opencode-home',
  target: 'opencode',
  kind: 'home',
  rootSegments: ['.opencode'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.opencode',
  validate: defaultValidateOpencodeHome,
});
