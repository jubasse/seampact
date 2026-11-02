"""Fixtures shared by the tests of `seampact-ninja`: the repository the golden IRs live in, and Django settings for
the tests that import the golden placement, since Ninja reads them at import."""

from pathlib import Path

import django
import pytest
from django.conf import settings

# python/ninja/ninja_tests/conftest.py: the repository root is three directories up from this one.
_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]

if not settings.configured:
    settings.configure(
        INSTALLED_APPS=["django.contrib.contenttypes", "django.contrib.auth", "seampact.django"],
        USE_TZ=True,
        SECRET_KEY="seampact-ninja-tests",
    )
    django.setup()


@pytest.fixture(scope="session")
def repository_root() -> Path:
    return _REPOSITORY_ROOT
