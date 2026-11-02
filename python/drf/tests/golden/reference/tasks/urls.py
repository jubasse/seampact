"""The URL patterns of api 'tasks': include them at "" in the root URLconf."""

import django.urls as _urls

from . import drf as _drf

urlpatterns = [
    _urls.path("v1/health", _drf.HealthView.as_view(), name="seampact.tasks.health"),
    _urls.path("v1/channels", _drf.ListChannelsView.as_view(), name="seampact.tasks.listChannels"),
    _urls.path("v1/me/preferences", _drf.GetPreferencesView.as_view(), name="seampact.tasks.getPreferences"),
    _urls.path("v1/hooks/payments", _drf.PaymentsView.as_view(), name="seampact.tasks.payments"),
    _urls.path("v1/me/drafts/<str:draft_id>", _drf.DeleteDraftView.as_view(), name="seampact.tasks.deleteDraft"),
    _urls.path("v1/channels/<str:channel_id>", _drf.GetChannelView.as_view(), name="seampact.tasks.getChannel"),
    _urls.path("v1/channels/<str:channel_id>/tasks", _drf.CreateTaskView.as_view(), name="seampact.tasks.createTask"),
    _urls.path(
        "v1/channels/<str:channel_id>/tasks/batch",
        _drf.GetTasksBatchView.as_view(),
        name="seampact.tasks.getTasksBatch",
    ),
    _urls.path(
        "v1/channels/<str:channel_id>/tasks/search",
        _drf.SearchTasksView.as_view(),
        name="seampact.tasks.searchTasks",
    ),
    _urls.path(
        "v1/channels/<str:channel_id>/tasks/<str:task_id>",
        _drf.GetTaskView.as_view(),
        name="seampact.tasks.getTask",
    ),
    _urls.path(
        "v1/channels/<str:channel_id>/tasks/<str:task_id>/archive",
        _drf.ArchiveTaskView.as_view(),
        name="seampact.tasks.archiveTask",
    ),
    _urls.path(
        "v1/channels/<str:channel_id>/tasks/<str:task_id>/assign",
        _drf.AssignTaskView.as_view(),
        name="seampact.tasks.assignTask",
    ),
    _urls.path(
        "v1/channels/<str:channel_id>/tasks/<str:task_id>/purge",
        _drf.PurgeTaskView.as_view(),
        name="seampact.tasks.purgeTask",
    ),
]
