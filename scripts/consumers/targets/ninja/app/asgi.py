"""The Django Ninja consumer as an ASGI app, as uvicorn serves it; building it runs the boot check."""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "settings")

application = get_asgi_application()
