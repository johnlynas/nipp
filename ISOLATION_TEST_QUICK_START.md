# Isolation tests quick start duide

This guide provides the essential steps to run the isolation tests locally. For detailed configuration and architecture information, see [ISOLATION_TEST_STRATEGY.md](./ISOLATION_TEST_STRATEGY.md).



## Full Test Run using single command

```bash
# One-command full run (setup → tests → teardown)
npm run test:isolation
```

## Test run with inidividual commands for granular control

```bash
docker compose -f docker-compose.test.yml up -d          # Start infra
./scripts/setup-test-env.sh                               # Create DB + seed
next dev                                                  # Start server (in another terminal)
npm test -- tests/isolation/application/                   # Run Vitest app-layer tests
npx playwright test                                       # Run Playwright E2E tests
./scripts/teardown-test-env.sh                            # Clean up DB
docker compose -f docker-compose.test.yml down            # Stop infra
```