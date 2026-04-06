# Release Notes — v0.2.0

## Scope
This is the stable **core** release for TraceProof on OpenClaw.

## Included
- one conversation trace per session
- automatic TraceProof grounding injection
- bundled public TraceProof skill
- inbound proof issue + verify
- outbound proof issue + verify
- Telegram duplicate outbound dedupe via `messageId`
- duplicate inbound dedupe via digest/time window

## Deliberately excluded
- visible Telegram/UI badge hacks
- channel-core patches to OpenClaw itself
- forced proof display in the visible channel UI
- subscriber-only / org-portal knowledge
- pricing, internal sales material, or private operating docs
- live secrets, tokens, session state, logs, test artifacts

## Positioning
Use this release as the safe baseline for:
- developer trials
- reference integrations
- public plugin publication
- future channel-specific UX work


## UI note
This release provides the verification core only. Showing TraceProof status in the visible chat/channel UI is up to the developer integrating the plugin.
