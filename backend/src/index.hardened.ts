// Install schema/route hardening before the main backend module evaluates.
import "./runtime/task-stats-hardening.js";
import "./runtime/auto-full-backup.js";
import "./runtime/notebook-publication.js";
import "./index.js";
