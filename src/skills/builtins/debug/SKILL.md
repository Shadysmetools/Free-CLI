---
name: debug
description: "Systematic debugging workflows for finding and fixing bugs: error analysis, stack trace reading, logging strategies, and root cause analysis. Use when debugging errors, crashes, or unexpected behavior."
---

# Debug Skill

## When to Use

- User reports a bug, error, or unexpected behavior
- Application crashes or throws exceptions
- Test failures with unclear root cause
- Performance issues or memory leaks

## Debugging Process

### 1. Reproduce First
Before fixing, confirm you can reproduce the issue:
```bash
# Run with verbose output
DEBUG=* npm run dev
NODE_ENV=development node --trace-warnings app.js
```

### 2. Read the Full Error
- Read the complete stack trace top to bottom
- Find the **first** frame in YOUR code (not node_modules)
- That's usually where the bug is

### 3. Isolate the Problem
```bash
# Add strategic console.log / console.error
# Narrow down: binary search the codebase

# For TypeScript: check types first
npx tsc --noEmit

# For async issues: look for unhandled promises
node --unhandled-rejections=throw app.js
```

### 4. Common Patterns

**TypeError / undefined:**
```typescript
// Check: is the variable initialized? Is it async?
// Add optional chaining: obj?.prop?.method?.()
```

**Import / module errors:**
```bash
# Check package installed: ls node_modules/<pkg>
# Check correct import path (case-sensitive on Linux)
# Check tsconfig paths
```

**Port in use:**
```bash
lsof -i :3000
kill -9 <PID>
```

**Environment variables:**
```bash
# Print all env vars the app sees
node -e "console.log(process.env)"
```

## Logging Best Practices

- Use structured logging: `{ event, data, error }` not raw strings
- Include timestamps and context in error logs
- Never log passwords, tokens, or PII
- Remove debug `console.log` before committing
