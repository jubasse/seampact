# One line per completed run of a workflow whose jobs may count as proofs, newest first: run id and commit. The run
# must be on $branch, of this repository (not a fork), from a push or a schedule; a non-empty $commit keeps only the
# runs of that commit. Its conclusion does not matter here: the job's own conclusion is read next (ci-job.jq).
.workflow_runs[]
| select(.status == "completed")
| select(.event == "push" or .event == "schedule")
| select(.head_branch == $branch)
| select($commit == "" or .head_sha == $commit)
| select(.head_repository.id == .repository.id)
| "\(.id) \(.head_sha)"
