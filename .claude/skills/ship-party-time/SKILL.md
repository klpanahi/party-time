---
name: ship-party-time
description: Takes a finished party-time change from a working tree to an open PR — branch naming, running test.sh and e2e.sh before pushing, commit message conventions, and gh pr create with a summary covering every layer touched. Use when the user says "ship this", "open a PR", "push this up", "create a pull request", or has finished implementing a change in party-time and wants it reviewed. Does not deploy — deploy is a separate step after merge, via deploy-party-time.
---

# Ship party-time

The PR half of the loop. `develop-party-time` implements a change;
this skill gets it in front of a human reviewer. **Deploying is a separate
step, after merge** — use `deploy-party-time` for that, never as part of
shipping.

## Prerequisites

- The change is implemented and you're satisfied it's complete — see the
  "Done means" checklist in `develop-party-time` if you haven't checked it.
- `gh` is available and authenticated.

## Workflow

### 1. Branch

One feature is one branch is one PR — everything for this change (app code,
nginx vhost, migration, deploy playbook tweak) goes in the same branch and PR
now that they all live in this repo. Name the branch for what it does, not
who asked:

```bash
git checkout -b <short-imperative-description>
```

### 2. Test before pushing, not after

```bash
./test.sh   # backend go test + admin_ui vitest + invitee_ui vitest
./e2e.sh    # proves routes are reachable through the real nginx vhost bodies
```

Run `./e2e.sh` whenever the change touched routing, nginx config, or added a
new endpoint — it's the only local check that proves a route survives the
nginx regex rather than silently falling back to the SPA shell. Both must be
green before you push. If either fails, fix it or report the failure; don't
push red.

### 3. Commit messages

Look at `git log` in this repo before writing one — the convention is
consistent:

- Imperative subject line, no trailing period, ideally under ~70 characters.
- The body explains **why**, not what — the diff already shows what changed.
  Lead with the problem being solved, then what changed and why that
  approach.
- Wrap body lines at ~72 characters.
- Multiple paragraphs are fine for a change that touched several layers —
  each commit in this repo's history typically explains one coherent
  problem/fix pair, even when the diff spans Go, nginx config, and a shell
  script.
- End with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

Example shape (see `git log --oneline -6` for real ones):

```
Replace schema.sql with embedded goose migrations

schema.sql was applied three different ways and was entirely CREATE
TABLE IF NOT EXISTS — on a database that already had the table, an
added column was silently never created, and tests couldn't catch it
because they rebuilt the schema from scratch every run.

Schema is now goose migrations under public_backend/migrations/,
embedded in the binary and run by a `migrate` subcommand on the same
image.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Only commit when the user has asked you to, or it's an expected part of
a task they've already directed. Never `git add -A`/`git add .` — stage
specific files.

### 4. Push and open the PR

```bash
git push -u origin <branch>
gh pr create --title "<short imperative title>" --body "$(cat <<'EOF'
## Summary
- <what changed and why, one or two bullets>

## Layers touched
- [ ] Backend (public_backend/)
- [ ] Admin UI (admin_ui/)
- [ ] Invitee UI (invitee_ui/)
- [ ] Migration (public_backend/migrations/)
- [ ] nginx vhost (deploy/nginx/public.conf or admin.conf)
- [ ] Deploy playbook (deploy/party-time.yml)

## Test plan
- [ ] ./test.sh passes
- [ ] ./e2e.sh passes (if routing/nginx/new endpoint touched)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

Keep only the checklist rows that are actually relevant to the change —
don't pad the PR body with boxes that don't apply. The point of listing
layers is that a change spanning Go + nginx + a migration is now one PR, and
a reviewer should be able to see at a glance which of those this one
touches.

### 5. Stop at review

Report the PR URL and stop. Do not merge, do not deploy. Merging and
deploying are explicit later steps the user (or CI) takes — this skill's job
ends when the PR is open and ready to review.

## After merge

Deploying is not part of shipping. Once the PR is merged to `main`, hand off
to the **`deploy-party-time`** skill (`./deploy.sh` from a clean, up-to-date
`main`) as its own, separate action.
