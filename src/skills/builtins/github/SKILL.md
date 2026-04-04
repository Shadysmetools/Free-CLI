---
name: github
description: "GitHub operations via gh CLI: issues, pull requests, CI runs, code review, API queries. Use when checking PR status, creating issues, merging PRs, or viewing workflow logs."
---

# GitHub Skill

Use the `gh` CLI for all GitHub operations. It handles auth automatically.

## When to Use

- Checking PR status, reviews, or CI
- Creating, commenting on, or closing issues
- Creating or merging pull requests
- Querying GitHub API for repo data
- Listing runs, releases, or collaborators

## Key Commands

```bash
# PRs
gh pr list --repo owner/repo
gh pr create --title "feat: ..." --body "..."
gh pr view 55 --repo owner/repo
gh pr checks 55 --repo owner/repo
gh pr merge 55 --squash

# Issues
gh issue list --state open
gh issue create --title "Bug: ..." --label bug
gh issue close 42

# CI / Workflows
gh run list --limit 10
gh run view <id> --log-failed
gh run rerun <id> --failed

# API (structured queries)
gh api repos/owner/repo/pulls/55 --jq '.title, .state'
gh issue list --json number,title --jq '.[] | "\(.number): \(.title)"'
```

## Tips

- Always `gh auth status` first if hitting auth errors
- Use `--repo owner/repo` when not inside a git directory
- Use URLs directly: `gh pr view https://github.com/owner/repo/pull/55`
- `--json` + `--jq` for machine-readable output
