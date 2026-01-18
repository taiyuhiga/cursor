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
