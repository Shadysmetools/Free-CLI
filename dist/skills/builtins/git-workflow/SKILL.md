---
name: git-workflow
description: "Advanced git workflows: rebase, cherry-pick, bisect, stash, worktrees, branching strategies, and conflict resolution. Use when doing advanced git operations beyond basic commit/push."
---

# Git Workflow

## When to Use

- Interactive rebase / squashing commits
- Cherry-picking commits across branches
- Bisecting to find bug introductions
- Managing stashes and worktrees
- Resolving complex merge conflicts
- Cleaning up branch history before PR

## Key Operations

### Interactive Rebase (clean up history)
```bash
git rebase -i HEAD~5          # rebase last 5 commits
git rebase -i origin/main     # rebase against main

# In the editor: pick, squash (s), fixup (f), reword (r), drop (d)
```

### Cherry-pick
```bash
git cherry-pick <commit-hash>         # apply single commit
git cherry-pick <hash1>..<hash2>      # apply range
git cherry-pick --no-commit <hash>    # stage without committing
```

### Stash
```bash
git stash push -m "description"       # save with message
git stash list                        # view all stashes
git stash pop                         # apply + remove latest
git stash apply stash@{2}             # apply specific stash
git stash drop stash@{0}              # remove stash
```

### Bisect (find bug regression)
```bash
git bisect start
git bisect bad                        # current commit is broken
git bisect good <known-good-commit>   # last known good commit
# git will checkout commits for you to test
git bisect good  # or: git bisect bad
git bisect reset  # when done
```

### Worktrees (multiple branches simultaneously)
```bash
git worktree add ../project-feature feature-branch
git worktree list
git worktree remove ../project-feature
```

### Conflict Resolution
```bash
git mergetool                         # visual merge tool
git checkout --ours <file>            # keep our version
git checkout --theirs <file>          # keep their version
git add <file> && git rebase --continue
```

## Branch Naming
- `feature/<name>` — new feature
- `fix/<name>` — bug fix
- `refactor/<name>` — code cleanup
- `chore/<name>` — maintenance
