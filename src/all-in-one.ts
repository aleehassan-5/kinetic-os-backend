// Combined entrypoint for free-tier hosting: runs the API server AND both
// BullMQ workers (workflow + social) in a single Node process/service,
// instead of needing 3 separate paid Render services.
//
// Each of these files self-starts on import (server.ts calls main(), and
// each worker file constructs `new Worker(...)` at module load time), so
// simply importing all three here is enough to run everything together.

import "./server";
import "./modules/workflows/workflow.worker";
import "./modules/social/social.worker";
