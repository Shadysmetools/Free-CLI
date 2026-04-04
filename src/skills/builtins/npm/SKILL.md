---
name: npm
description: "Node.js project management with npm, pnpm, or yarn: installing packages, running scripts, managing dependencies, publishing packages. Use when working with Node.js projects."
---

# npm / Node.js Project Management

## When to Use

- Installing or updating npm packages
- Running npm scripts (build, test, dev, etc.)
- Managing package.json dependencies
- Troubleshooting node_modules issues
- Publishing to npm registry

## Package Managers

Detect which package manager is in use:
```bash
# Check for lockfiles
ls package-lock.json   # npm
ls yarn.lock           # yarn
ls pnpm-lock.yaml      # pnpm
ls bun.lockb           # bun
```

## Key Commands

```bash
# Install
npm install                    # install all deps
npm install <pkg>              # add dependency
npm install -D <pkg>           # add dev dependency
npm install -g <pkg>           # install globally

# Scripts
npm run dev                    # start dev server
npm run build                  # build project
npm test                       # run tests
npm run lint                   # run linter

# Maintenance
npm outdated                   # check outdated packages
npm update                     # update minor/patch
npm audit                      # security audit
npm audit fix                  # auto-fix vulnerabilities
npm cache clean --force        # clear cache

# Troubleshooting
rm -rf node_modules package-lock.json && npm install  # full reinstall
```

## package.json Tips

- `scripts.dev` — development server
- `scripts.build` — production build
- `scripts.test` — test runner
- `engines.node` — required Node version
- `peerDependencies` — framework deps (install manually)
