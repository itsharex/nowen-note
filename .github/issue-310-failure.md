Issue #310 migration validation failed.

Workflow commit: 23bc621103a1872c908140de0ee4613095f0ab71
Run: https://github.com/cropflre/nowen-note/actions/runs/29467429280

Last log lines:
```text
node:internal/modules/cjs/loader:1210
  throw err;
  ^

Error: Cannot find module '/home/runner/work/nowen-note/nowen-note/.github/scripts/apply-issue-310.mjs'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1207:15)
    at Module._load (node:internal/modules/cjs/loader:1038:27)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:164:12)
    at node:internal/main/run_main_module:28:49 {
  code: 'MODULE_NOT_FOUND',
  requireStack: []
}

Node.js v20.20.2
```
