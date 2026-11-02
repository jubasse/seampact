"""Boots a Python consumer under uvicorn for one boot case (ADR 0015 "Boot tests"): `python boot.py <module:app>`, run
in the app's directory, prints the started line and exits 0 once the app's startup completed, and exits 3, as uvicorn
does, when the startup failed."""

import asyncio
import os
import sys
from typing import Final

import uvicorn

STARTED_LINE: Final = "seampact-suite: started"
STARTUP_FAILURE: Final = 3
_POLL_SECONDS: Final = 0.05
_USAGE: Final = "usage: boot.py <module:app>"


async def boot(application: str) -> int:
    server = uvicorn.Server(uvicorn.Config(application, host="127.0.0.1", port=0, lifespan="on"))
    serving = asyncio.create_task(server.serve())

    while not server.started and not serving.done():
        await asyncio.sleep(_POLL_SECONDS)

    if not server.started:
        await serving

        return STARTUP_FAILURE

    print(STARTED_LINE, flush=True)
    server.should_exit = True
    await serving

    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(_USAGE)

    # The app's modules sit in the directory the boot runs in, as `uvicorn --app-dir .` reads them.
    sys.path.insert(0, os.getcwd())
    sys.exit(asyncio.run(boot(sys.argv[1])))
