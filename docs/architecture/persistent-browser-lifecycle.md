# Persistent Browser Lifecycle and Human-in-the-Loop Resume

Status: required design for authenticated browser workflows.

## Problem

The browser process must not be owned by one LLM turn or one short-lived task execution. A common flow is:

1. agent opens LinkedIn/Facebook/Azure;
2. site requires login/MFA/CAPTCHA;
3. user must interact manually;
4. agent waits;
5. user says "continue";
6. the same browser/session/tab continues.

Closing the browser when the agent cannot proceed destroys context and forces the user to repeat login/navigation.

## Architectural rule

Browser lifetime is owned by a long-lived `BrowserHost`/gateway daemon, not by the calling agent process or tool call.

```text
Agent / OrquestadorZao
        |
        v
 Browser Gateway API/MCP
        |
        v
    BrowserHost daemon
        |
   +----+----------------+
   |                     |
Obscura runtime      Playwright runtime
   |                     |
 logical BrowserSession / tabs
```

A caller may disconnect or end its turn while the browser remains alive.

## Session states

```text
CREATED
  -> ACTIVE
  -> WAITING_FOR_USER
  -> RESUMABLE
  -> ACTIVE
  -> COMPLETED
  -> IDLE
  -> CLOSED

Any state may move to FAILED/EXPIRED/REAUTHENTICATION_REQUIRED when appropriate.
```

`WAITING_FOR_USER` is a first-class successful suspension state, not an error.

## Human handoff flow

When authentication or another allowed human-only step is required:

1. Keep browser/context/page open.
2. Save a checkpoint containing `activityId`, `browserSessionId`, `tab/page ref`, URL, reason and safe instructions.
3. Return `user_interaction_required` with a resumable token/reference.
4. Notify the caller/user that the browser is waiting.
5. Do not close due to tool timeout, LLM turn completion, or caller disconnect.
6. User performs login/MFA/CAPTCHA manually in the visible browser.
7. User says/executes `continue` or `resume <activity>`.
8. OrquestadorZao resolves the suspended activity and sends `resume(browserSessionId, checkpointId)`.
9. Gateway re-validates page/session state and continues from the existing tab.

If the original process crashed, restore encrypted auth state where possible and return a typed status describing whether exact tab continuation was possible.

## Browser process vs auth persistence

These are separate guarantees:

- **Live continuity**: same running browser/tab remains open during a human pause.
- **Durable auth**: encrypted session state survives browser/process restart.

Both are required. Durable auth does not replace live continuity.

## Lifetime policy

Default policy:

- never close an ACTIVE or WAITING_FOR_USER session automatically;
- explicit user/gateway `close` always wins;
- completed sessions may enter IDLE;
- configurable idle TTL may reclaim resources only after state is safely checkpointed;
- authenticated named profiles may be reopened later from `SessionVault`;
- WAITING_FOR_USER uses a much longer/no automatic TTL unless an administrator policy says otherwise.

## Concurrency

A browser session must have an owner/lease so two agents cannot drive the same tab simultaneously. Read-only observers may be supported later, but one actor owns mutation at a time.

## Security

Human interaction does not increase permissions. After login, publication, sending messages, job submission, purchases and destructive actions still require their normal approval gate.

Do not expose cookies/passwords/storage state in the resume payload. Only opaque session/checkpoint identifiers are returned.

## Required API concepts

- `createSession(profile?)`
- `getSessionStatus(sessionId)`
- `suspendForUser(sessionId, reason)`
- `resumeSession(sessionId, checkpointId)`
- `listWaitingSessions()`
- `checkpointSession(sessionId)`
- `closeSession(sessionId)`

## Acceptance tests

1. Start headed Playwright, navigate to a login page, suspend, wait beyond a normal tool timeout, then resume; browser PID/context/tab remain alive.
2. Ending/restarting the caller process does not close the BrowserHost session.
3. Two sessions remain isolated.
4. `WAITING_FOR_USER` cannot be garbage-collected by the normal idle TTL.
5. Explicit close releases browser resources.
6. Simulated BrowserHost restart restores durable auth where supported and returns a typed continuity status.
7. A resumed authenticated session still enforces approval policy for side effects.
