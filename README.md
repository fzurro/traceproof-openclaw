# TraceProof Runtime for OpenClaw

TraceProof adds provenance-first verification to real OpenClaw conversations.

This package enables:
- one TraceProof conversation trace per session
- verified inbound message proofs
- verified outbound message proofs

Register a free developer account at **traceproof.org** to create an Agent and credential for testing.

**Important:** this package enables TraceProof verification, but it does **not** automatically render proof state in the visible chat UI. Showing badges, verify links, QR codes, or proof summaries in a channel or app UI is the responsibility of the developer integrating OpenClaw.

---

## What this release does

- Bundles the TraceProof runtime plugin for OpenClaw
- Creates one TraceProof conversation trace on the first message in a session
- Issues and verifies inbound message proofs (`message:received`)
- Issues and verifies outbound message proofs (`message:sent`)
- Stores per-session state in the agent workspace for trace continuity and dedupe
- Dedupes duplicate Telegram outbound events using `messageId`
- Dedupes duplicate inbound events using digest + short time window
- Includes bundled TraceProof grounding files for use in the OpenClaw workspace

---

## What this release does not do

- It does not force visible per-channel UI banners or badges
- It does not fetch and render QR image binaries in chat
- It does not replace channel-specific UX logic inside OpenClaw core
- It does not automatically make the assistant knowledgeable about TraceProof unless the bundled workspace grounding is also copied into the active workspace

This release is the stable **core build**.

Treat Telegram as the reference **proofing** channel, not the reference UX-banner implementation.

---

## UI / channel display note

This package enables TraceProof in OpenClaw conversations, but it does **not** force TraceProof status, badges, verify links, or QR codes to appear in the visible chat UI.

In practice, this means:
- the plugin creates the conversation trace
- the plugin issues and verifies inbound/outbound message proofs
- the developer decides how to surface verify URLs, public references, QR codes, or proof status in their own channel or app UI

---

## Package contents

- `index.js` — runtime plugin
- `openclaw.plugin.json` — manifest + config schema
- `bootstrap/AGENTS.md` — workspace grounding file
- `skills/traceproof/SKILL.md` — public TraceProof skill
- `openclaw.config.template.json` — config template with placeholders
- `RELEASE-NOTES.md` — release scope and limits

---

## Installation

Installation has **two parts**:

1. install the runtime plugin  
2. copy the bundled TraceProof grounding into the active OpenClaw workspace

### 1) Install the TraceProof runtime plugin

From the package folder:

```bash
openclaw plugins install /absolute/path/to/traceproof-openclaw
openclaw plugins enable traceproof-runtime
openclaw gateway restart
```

This installs the core runtime that:
- creates a TraceProof conversation trace
- issues and verifies inbound/outbound message proofs
- stores per-session state in `<workspace>/.traceproof-runtime/sessions.json`

### 2) Install the TraceProof workspace grounding

For the best and most predictable TraceProof product answers in chat, also copy the bundled grounding into the active OpenClaw workspace.

#### Windows (PowerShell)

```powershell
Copy-Item ".\bootstrap\AGENTS.md" "$HOME\.openclaw\workspace\AGENTS.md" -Force
New-Item -ItemType Directory -Path "$HOME\.openclaw\workspace\skills\traceproof" -Force
Copy-Item ".\skills\traceproof\SKILL.md" "$HOME\.openclaw\workspace\skills\traceproof\SKILL.md" -Force
openclaw gateway restart
```

#### macOS / Linux

```bash
cp ./bootstrap/AGENTS.md ~/.openclaw/workspace/AGENTS.md
mkdir -p ~/.openclaw/workspace/skills/traceproof
cp ./skills/traceproof/SKILL.md ~/.openclaw/workspace/skills/traceproof/SKILL.md
openclaw gateway restart
```

This step is recommended because:
- `AGENTS.md` in the workspace root provides the TraceProof operating guidance
- `skills/traceproof/SKILL.md` in the workspace makes the TraceProof skill available from the highest-precedence location

---

## Configuration

Create a free developer account at **traceproof.org**, then create:
- a TraceProof Agent
- a TraceProof credential

Add this block to `~/.openclaw/openclaw.json` and replace the placeholders:

```json
{
  "plugins": {
    "entries": {
      "traceproof-runtime": {
        "enabled": true,
        "config": {
          "apiBaseUrl": "https://api.traceproof.org",
          "agentId": "<YOUR_TRACEPROOF_AGENT_ID>",
          "credentialKey": "<YOUR_TRACEPROOF_CREDENTIAL_KEY>",
          "channel": "chat",
          "sourceSystem": "openclaw",
          "originLabel": "openclaw-chat",
          "qrFormat": "svg",
          "verifyProofs": true,
          "debug": false
        }
      }
    }
  }
}
```

---

## First test

1. Start or open a real OpenClaw conversation
2. Send a message such as:
   - `What is TraceProof?`
   - `tell me about traceproof`
3. Wait for the assistant reply
4. Check the session state file

### Example check

#### macOS / Linux

```bash
cat ~/.openclaw/workspace/.traceproof-runtime/sessions.json
```

#### Windows (PowerShell)

```powershell
type $HOME\.openclaw\workspace\.traceproof-runtime\sessions.json
```

You should see:
- one conversation trace
- `publicReference`
- `verifyUrl`
- one `IN` proof
- one `OUT` proof once the assistant replies

See `samples/sessions.json.sample` for an example.

---

## State path

Per-session state is written to:

```text
<workspace>/.traceproof-runtime/sessions.json
```

---

## Recommended public positioning

Describe this package as:

**TraceProof for OpenClaw — core verification runtime**

That accurately matches the stable behavior in this release.

---

## Summary

This package gives OpenClaw:
- a TraceProof conversation trace
- verified inbound proofs
- verified outbound proofs
- persistent per-session verification state

It does **not** define how proof state should look in a channel UI. That part is left to the developer integrating OpenClaw into their own user experience.
