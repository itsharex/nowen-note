Issue #310 migration validation failed.

Workflow commit: 982d65010cb3b98930c01787eeaa7aa40fd8b7c9
Run: https://github.com/cropflre/nowen-note/actions/runs/29467361510

Last log lines:
```text
file:///home/runner/work/nowen-note/nowen-note/.github/scripts/apply-issue-310.mjs:15
  if (index < 0) throw new Error(`[issue-310] Missing ${label}`);
                       ^

Error: [issue-310] Missing lucide import
    at replaceOnce (file:///home/runner/work/nowen-note/nowen-note/.github/scripts/apply-issue-310.mjs:15:24)
    at file:///home/runner/work/nowen-note/nowen-note/.github/scripts/apply-issue-310.mjs:190:10
    at ModuleJob.run (node:internal/modules/esm/module_job:325:25)
    at async ModuleLoader.import (node:internal/modules/esm/loader:606:24)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v20.20.2
```
