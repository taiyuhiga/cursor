# GC Runbook (uploads cleanup)

## Purpose

This runbook helps detect and resolve issues in the `gc_jobs` queue:

- Backlog (queued)
- Stuck jobs (running)
- Increased failures (error)

## Quick checks (start here)

### Status counts

```sql
select status, count(*)
from gc_jobs
group by status
order by status;
```

What to look for:

- `queued` steadily increasing (backlog)
- `running` not returning to near-zero (stuck workers)
- `error` increasing (systemic failures)

---

## Backlog detection (stale queued)

### Queued jobs past their scheduled time

```sql
select count(*) as queued_stale
from gc_jobs
where status = 'queued'
  and run_after < now() - interval '10 minutes';
```

Actions:

- If `queued_stale > 0` persists:
  - Increase `GC_BATCH_SIZE` and/or run frequency
  - Check recent failures (errors can cause effective backlog)

---

## Stuck detection (stale running)

### Running jobs that appear hung

```sql
select count(*) as running_stuck
from gc_jobs
where status = 'running'
  and updated_at < now() - interval '15 minutes';
```

Actions:

- Confirm worker health (process crash / timeouts / deployment issues)
- Inspect affected job(s): `last_error_phase`, `last_error`, `last_summary`
- If you have an operational procedure for recovery, either:
  - Re-queue stuck jobs (`running -> queued`) and retry, or
  - Mark as `error` after max attempts

---

## Failures (error) triage

### Recent failures overview

```sql
select
  id,
  node_id,
  attempts,
  status,
  updated_at,
  last_error_phase,
  left(coalesce(last_error, ''), 200) as last_error_preview
from gc_jobs
where status = 'error'
order by updated_at desc
limit 50;
```

Actions:

- If the same `last_error_phase` repeats:
  - Suspect that specific phase (e.g., list/delete I/O) or permissions
- Validate `last_summary` fields (prefix/path correctness)

---

## Inspect a specific job

```sql
select
  id,
  node_id,
  status,
  attempts,
  updated_at,
  last_error_phase,
  last_error,
  last_summary
from gc_jobs
where id = '<JOB_ID>';
```

Key fields to verify:

- `last_summary.prefix`
- `last_summary.current_storage_path`
- `last_summary.list_count`
- `last_summary.deleted_count`
- `duration_ms` (if stored separately or in summary)

---

## Recommended defaults (explicit configuration)

- `GC_KEEP_COUNT=3`
- `GC_BATCH_SIZE=25`
- `GC_MAX_ATTEMPTS=5`
- `GC_BACKOFF_BASE_SECONDS=30`

Guidance:

- Backlog grows: increase `GC_BATCH_SIZE` or frequency
- Many failures: fix root cause before increasing retries
- Storage growth: consider lowering `GC_KEEP_COUNT` after stability is confirmed

---

## Manual recovery (stop the bleeding first)

When things look unstable, use this order:

1. Pause the worker trigger (cron / scheduled action)
2. Inspect queue health using the SQL above
3. Recover stuck jobs (see below)
4. Resume the worker trigger

### Re-queue stuck running jobs

```sql
update gc_jobs
set status = 'queued',
    run_after = now(),
    updated_at = now()
where status = 'running'
  and updated_at < now() - interval '15 minutes';
```

### Force-stop and mark as error

```sql
update gc_jobs
set status = 'error',
    updated_at = now()
where status = 'running'
  and updated_at < now() - interval '30 minutes';
```

---

## Common issues and fixes (FAQ)

### `list` returns empty or timestamps are missing

Symptoms:

- `last_error` is empty but `last_summary.note = "no_timestamps"`
- Deletions are skipped even when uploads exist

Actions:

- Check if storage objects have `updated_at` or `created_at` set
- Confirm the storage path prefix and bucket are correct

### `remove` fails with permissions error

Symptoms:

- `last_error_phase = "delete"`
- Errors mention permission/authorization

Actions:

- Ensure the worker uses `SUPABASE_SERVICE_ROLE_KEY`
- Verify bucket policies allow deletes for service role

### `prefix` looks wrong after path rule changes

Symptoms:

- `last_summary.prefix` does not match current path rules

Actions:

- Validate upload path construction in `create-upload-url`
- Reconcile any migration or path format changes

---

## Alert thresholds (suggested)

Use these as initial SLO-style thresholds and tune later:

- `queued_stale > 0` for 10+ minutes
- `running_stuck > 0` for 15+ minutes
- `error` count grows continuously for 30+ minutes

---

## Enqueue source and configuration

### Enqueue source

- `confirm-upload` enqueues `gc_jobs` after a successful reference switch

### Config values (env)

- `GC_KEEP_COUNT` (default 3)
- `GC_BATCH_SIZE` (default 25)
- `GC_MAX_ATTEMPTS` (default 5)
- `GC_BACKOFF_BASE_SECONDS` (default 30)

---

## Safety guardrails

Non-negotiables:

- Never delete the current reference (`file_contents.text` -> `storage:<path>`)
- Keep at least `GC_KEEP_COUNT >= 1`

Safety limits (recommendations):

- Cap deletions per job to a safe upper bound
- If you add a hard cap, record the cap hit in logs and `last_summary`

---

## Monitoring baselines (examples)

Healthy steady-state examples:

- `queued_stale = 0`
- `running_stuck = 0`
- `error` rate near 0 (sporadic errors are acceptable if they recover)

Typical patterns:

- `queued` grows while `error` stays low: capacity shortfall (increase batch or frequency)
- `error` grows while `queued` stays low: permission or path issues

---

## Secrets and rotation (operational ownership)

GC requires delete privileges. Treat these as high-risk secrets:

- `SUPABASE_SERVICE_ROLE_KEY`
- `GC_WORKER_TOKEN`

Guidance:

- Store only in server-side env (never client)
- Rotate on suspected leak; redeploy worker immediately
- Keep a documented owner for pause/resume of the worker trigger

---

## Optional SLO (directional)

Example SLO:

- "Cleanup backlog returns to <= `GC_KEEP_COUNT` within 30 minutes of reference switch."
