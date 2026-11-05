# One line per unexpired http-suite artefact made by a run of this repository on $branch: name, run id, creation time.
# A fork's run has another head repository, and a fork pull request from a branch of the same name must not count.
.artifacts[]
| select(.expired | not)
| select(.name | test("-http-suite-"))
| select(.workflow_run.head_branch == $branch)
| select(.workflow_run.head_repository_id == .workflow_run.repository_id)
| "\(.name) \(.workflow_run.id) \(.created_at)"
