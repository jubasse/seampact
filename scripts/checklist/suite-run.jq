# The commit of a workflow run whose artefacts may count as proofs, and nothing for any other run: it succeeded, on
# $branch, of this repository (not a fork), from a push or a schedule (never a pull request). A non-empty $commit
# keeps only the runs of that commit. A non-empty $runs, the space-separated ids of the runs the release started at
# its commit, keeps only those runs, which are manual runs.
select(.conclusion == "success")
| select(if $runs == "" then .event == "push" or .event == "schedule"
         else .event == "workflow_dispatch" and ((.id | tostring) as $id | $runs | split(" ") | any(. == $id)) end)
| select(.head_branch == $branch)
| select($commit == "" or .head_sha == $commit)
| select(.head_repository.id == .repository.id)
| .head_sha
