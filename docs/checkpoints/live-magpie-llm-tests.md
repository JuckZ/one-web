# Real Windows Magpie LLM acceptance

Date:2026-11-16, CachyOS Linux. User explicitly authorized real LLM tests through the Windows Magpie
gateway used by local Codex. This task preserves the transferred previous smart-apps dirty baseline
and does not erase its separate Firefox full-gate limitation.

## Changes

- Separate opt-in production Chromium suite/runner. Normal Playwright discovery excludes live
  specs; absent opt-in, the runner exits before reading credentials or making requests.
- Finite loopback relay reads effective Codex provider/model; actual key stays in Node memory,
  browser uses a synthetic alias; real Chat Completions bytes are forwarded without canned output.
- Page/selection tests vary IDs/facts every run and check grounded structured output. Actual
  generated HTML is previewed, clicked, operated with Enter/Space, saved/reloaded and disabled;
  browser/API/parent isolation is checked on that generated application.
- Nine new HTTP provider cases cover reasoning/usage metadata, terminal cleanup, pending-read
  abort/late bytes, redirect refusal, incomplete streams, formats/UTF-8 and wire cap. Synthetic
  servers trigger errors without deliberately failing paid calls.
- Four relay tests cover opt-in, unchanged stream, fixed endpoint/model, alias/cookie/header/key
  isolation, sanitized errors and no retry. A subprocess test covers signal termination.

## Failures reproduced and fixed

The new HTTP429 held-open-body test failed on the prior provider: status rejection left the
connection open. The provider now cancels the body before raising its existing status-only error;
the same assertion passes. Independent review found that a signalled Playwright child mapped to
success. A SIGTERM subprocess regression reproduced exit0; the runner now requires status===0,
and the same regression observes exit1. Before/after logs remain in the task records.

## Real-model evidence

The configured Windows Magpie model `codex/gpt-6.1-terra` returned HTTP200, six content deltas and
`[DONE]` with the requested compatibility marker in3.26s. Native Chat Completions was verified,
rather than inferred from Codex's Responses setting.

The first production extension live run passed both tests in35.2s: three real requests for page
facts, selected facts, and the generated counter. The final configured live run persists its JSON
metadata report. Final checks, precise source binding, counts/timings, attestation and independent
review live in Git common-dir `agent-factory/tasks/live-magpie-tests…/result.md`; intermediate
success is not substituted for final evidence.

## Limits

These samples verify specific model/workflow behavior, not all generated apps or subjective model
quality. Only synthetic content and disposable profiles are used; no automatic paid retry. Network,
quota and model compliance remain possible live failures. This Chromium acceptance does not prove
Windows/macOS/Firefox UI parity or resolve the separately recorded Firefox driver failure. No user
browser/provider settings, actual credentials or legacy RepoLens project is modified.
