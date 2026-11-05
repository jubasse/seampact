# The commit of a workflow run whose artefacts may count as proofs, and nothing for any other run: it succeeded, on
# $branch, of this repository (not a fork), from a push or a schedule (never a pull request). A non-empty $commit
# keeps only the runs of that commit.
select(.conclusion == "success")
| select(.event == "push" or .event == "schedule")
| select(.head_branch == $branch)
| select($commit == "" or .head_sha == $commit)
| select(.head_repository.id == .repository.id)
| .head_sha
