const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildValidationIssue,
  createInstallTargetAdapter,
} = require('./helpers');

const COMPILED_PLUGIN_RELATIVE_PATH = path.join('.opencode', 'dist', 'index.js');
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

  const compiledPluginPath = path.join(input.repoRoot, COMPILED_PLUGIN_RELATIVE_PATH);
  if (!fs.existsSync(compiledPluginPath)) {
    return [
      buildValidationIssue(
        'error',
        'opencode-plugin-not-built',
        'OpenCode install requires the compiled plugin payload at '
          + `${COMPILED_PLUGIN_RELATIVE_PATH}, but it was not found. Run `
          + `${BUILD_COMMAND_HINT} from the repo root before re-running the installer.`,
        { compiledPluginPath }
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
