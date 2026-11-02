"""Fixtures shared by the tests of `seampact-drf`: the repository the golden IRs live in, and Django settings for the
tests that build serializers and views."""

from pathlib import Path

import django
import pytest
from django.conf import settings

# python/drf/drf_tests/conftest.py: the repository root is three directories up from this one.
_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]

if not settings.configured:
    settings.configure(
        INSTALLED_APPS=["django.contrib.contenttypes", "django.contrib.auth", "rest_framework", "seampact.django"],
        ROOT_URLCONF="seampact_drf_golden_tasks.urls",
        USE_TZ=True,
        # An idempotency store that uses the ORM, as a Django app's would, reads it.
        DATABASES={"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}},
        # Django's technical pages under DEBUG read it.
        SECRET_KEY="seampact-drf-tests",
    )
    django.setup()


@pytest.fixture(scope="session")
def repository_root() -> Path:
    return _REPOSITORY_ROOT
