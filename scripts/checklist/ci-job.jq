# The conclusion of a cited job in one run's jobs: "success" when every matching job that ran succeeded, "failure"
# when one did not, nothing when none ran (skipped or absent), so the fetcher reads an older run. A job matches by
# its name, or by the name's start for a matrix job ($mode "prefix").
[.jobs[]
 | select(if $mode == "prefix" then (.name | startswith($name)) else .name == $name end)
 | select(.conclusion != "skipped")
 | .conclusion]
| if length == 0 then empty elif all(. == "success") then "success" else "failure" end
