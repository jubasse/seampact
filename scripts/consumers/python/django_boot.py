"""Boots a Django consumer for one boot case (ADR 0015 "Boot tests"): `python django_boot.py <module>`, run in the app's
directory, imports the WSGI or ASGI module, whose handler builds the middleware and so runs the boot check, then prints
the started line and exits 0; a refused boot exits 3, as a gunicorn worker that failed to boot does."""

import importlib
import os
import sys
import traceback
from typing import Final

from django.core.exceptions import ImproperlyConfigured

STARTED_LINE: Final = "seampact-suite: started"
STARTUP_FAILURE: Final = 3
_USAGE: Final = "usage: django_boot.py <wsgi or asgi module>"


def boot(module: str) -> int:
    try:
        importlib.import_module(module)
    except ImproperlyConfigured:
        traceback.print_exc()

        return STARTUP_FAILURE

    print(STARTED_LINE, flush=True)

    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(_USAGE)

    # The app's modules sit in the directory the boot runs in, as gunicorn's `--chdir` reads them.
    sys.path.insert(0, os.getcwd())
    sys.exit(boot(sys.argv[1]))
