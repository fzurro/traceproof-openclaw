# Publishing

## 1) Check package contents

```bash
npm pack --dry-run
```

## 2) Publish to npm

```bash
npm publish --access public
```

## 3) Publish / update on ClawHub

Use your normal ClawHub publish flow for the same version after npm is live.

## 4) Recommended verification

- confirm the new version on npm
- confirm the new version on ClawHub
- install the plugin in a clean OpenClaw setup
- verify one conversation trace, one inbound proof, and one outbound proof
