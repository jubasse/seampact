"""The Django Ninja consumer as a WSGI app, as gunicorn serves it; building it runs the boot check."""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "settings")

application = get_wsgi_application()
