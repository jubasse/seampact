"""The URL patterns of api 'tasks': include them at "" in the root URLconf."""

import django.urls as _urls

from . import drf as _drf

urlpatterns = [
    _urls.path(
        "v1/channels/<str:path_channel_id>/tasks",
        _drf.CreateTaskView.as_view(),
        name="seampact.tasks.createTask",
    ),
]
