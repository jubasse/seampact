"""The URL patterns of api 'tasksService': include them at "" in the root URLconf."""

import django.urls as _urls

from . import drf as _drf

urlpatterns = [
    _urls.path(
        "internal/v1/channels/<str:channel_id>/tasks/<str:task_id>",
        _drf.GetTaskView.as_view(),
        name="seampact.tasksService.getTask",
    ),
]
