# Delta for Build & Execution Targets

## ADDED Requirements

### Requirement: Package Management
npm SHALL be used as the exclusive package management tool for the project.

#### Scenario: Dependency Installation
- GIVEN a developer clones the repository
- WHEN they install dependencies
- THEN they MUST use `npm install`. No other package managers are permitted.

### Requirement: Node.js 22 LTS Version Pinning
The project MUST pin to Node.js 22 LTS to ensure compatibility, stability, and long-term support.

#### Scenario: .nvmrc File
- GIVEN the project is initialized
- WHEN a developer uses nvm
- THEN the `.nvmrc` file MUST contain exactly `22` (not `22.x`, `23`, or any other version).
- THEN running `nvm use` MUST switch to Node.js 22.x.x (the latest 22.x release).
- THEN this ensures all developers and CI environments use the same LTS version.

#### Scenario: package.json engines Field
- GIVEN the project is initialized
- WHEN dependencies are installed via `npm install`
- THEN the `engines` field in `package.json` MUST be: `"engines": { "node": ">=22.0.0 <23.0.0" }`
- THEN npm MUST refuse to install dependencies if the current Node.js version is not 22.x.x.
- THEN this prevents accidental use of Node 23 or other non-LTS versions.

#### Scenario: Version Justification
- GIVEN the Node.js version is pinned to 22 LTS
- WHEN a developer or CI environment attempts to use a different version
- THEN the documentation MUST explain:
  - Node 22 is LTS (supported until April 2027)
  - Vitest 4.x requires `^20.0.0 || ^22.0.0 || >=24.0.0` (Node 23 is explicitly excluded)
  - Node 23 is odd-numbered, non-LTS, and unsupported by many packages
  - All project dependencies (Next.js 15+, Prisma 6.x, BetterAuth 1.6.x) are tested against Node 22
  - Using Node 22 ensures consistent behavior across development, CI, and production

#### Scenario: CI/CD Node.js Version
- GIVEN the GitHub Actions CI/CD workflows are configured
- WHEN the workflows run
- THEN they MUST use Node.js 22.x (via `actions/setup-node@v4` with `node-version: '22'`).
- THEN the CI environment MUST match the local development environment.

### Requirement: Next.js 15 and React 19 Version Pinning
The project MUST pin to Next.js 15.x with React 19.x to ensure API stability and compatibility with BetterAuth.

#### Scenario: package.json Dependencies
- GIVEN the project is initialized
- WHEN dependencies are installed
- THEN `package.json` MUST specify:
  - `"next": "^15.x.x"` (allows minor/patch updates within 15.x)
  - `"react": "^19.x.x"` (required by Next.js 15)
  - `"react-dom": "^19.x.x"` (must match React version)
  - `"@types/react": "^19.x.x"` (devDependency)
  - `"@types/react-dom": "^19.x.x"` (devDependency)
- THEN npm MUST install these specific major versions.

#### Scenario: Version Justification
- GIVEN the Next.js version is pinned to 15
- WHEN a developer or CI environment asks why Next.js 15
- THEN the documentation MUST explain:
  - Next.js 15 provides stable App Router, Route Handlers, and middleware APIs
  - BetterAuth's `toNextJsHandler` is tested against Next.js 15
  - `--experimental-https` flag is available for local-prod HTTPS
  - Next.js 15 requires React 19, so both are pinned together
  - Major version upgrades (e.g., Next.js 16) require a separate OpenSpec proposal

#### Scenario: Major Version Upgrade Policy
- GIVEN the project is using Next.js 15
- WHEN a new major version of Next.js is released (e.g., Next.js 16)
- THEN upgrading MUST be treated as a separate OpenSpec proposal.
- THEN the upgrade proposal MUST assess breaking changes and migration effort.
- THEN the upgrade MUST NOT happen implicitly via `npm update`.

#### Scenario: Minor/Patch Updates
- GIVEN the project is using Next.js 15.x
- WHEN a minor or patch update is released (e.g., 15.1.0, 15.0.5)
- THEN the update MAY be applied via `npm update` to receive security patches.
- THEN CI MUST verify the update does not break existing functionality.

### Requirement: Vitest 4.x Version Pinning
The project MUST pin to Vitest 4.x to ensure compatibility with BetterAuth test-utils and Node.js 22 LTS.

#### Scenario: package.json Dependencies
- GIVEN the project is initialized
- WHEN dependencies are installed
- THEN `package.json` MUST specify:
  - `"vitest": "^4.1.5"` (required by @better-auth/test-utils)
  - `"@better-auth/test-utils": "^1.6.23"` (test utilities)
- THEN npm MUST install these specific versions
- THEN the installation MUST NOT fail with peer dependency conflicts

#### Scenario: Version Justification
- GIVEN the Vitest version is pinned to 4.x
- WHEN a developer or CI environment asks why Vitest 4.x
- THEN the documentation MUST explain:
  - Vitest 4.x is required by @better-auth/test-utils@1.6.23
  - Vitest 4.x requires Node.js `^20.0.0 || ^22.0.0 || >=24.0.0` (Node 23 is excluded)
  - Vitest 4.x provides stable testing APIs compatible with Next.js 15
  - Major version upgrades (e.g., Vitest 5.x) require a separate OpenSpec proposal

#### Scenario: Major Version Upgrade Policy
- GIVEN the project is using Vitest 4.x
- WHEN a new major version of Vitest is released (e.g., Vitest 5.x)
- THEN upgrading MUST be treated as a separate OpenSpec proposal
- THEN the upgrade proposal MUST assess:
  - Breaking changes in test APIs
  - Compatibility with @better-auth/test-utils
  - Compatibility with Node.js 22 LTS
  - Migration effort for existing tests
- THEN the upgrade MUST NOT happen implicitly via `npm update`

#### Scenario: Minor/Patch Updates
- GIVEN the project is using Vitest 4.x
- WHEN a minor or patch update is released (e.g., 4.2.0, 4.1.6)
- THEN the update MAY be applied via `npm update` to receive bug fixes and security patches
- THEN CI MUST verify the update does not break existing tests
- THEN the @better-auth/test-utils peer dependency MUST still be satisfied

### Requirement: Local Developer Build Target (PostgreSQL)
The project MUST provide npm commands to setup, build, test, and execute the Next.js application in a local development environment.

#### Scenario: Developer Execution Scripts
- GIVEN the `package.json` is configured
- WHEN the developer runs the execution command (`npm run dev`)
- THEN the script MUST start the Next.js development server.
- THEN both UI and API MUST be served from the same origin.
- THEN the developer MUST have PostgreSQL installed locally and configured via `DATABASE_URL`.

### Requirement: Local Production Build Target (PostgreSQL + HTTPS)
The project MUST provide npm commands to execute the application in a local production-like environment using PostgreSQL and HTTPS.

#### Scenario: Local Production Execution Scripts
- GIVEN the `package.json` is configured
- WHEN the developer runs the local production start command (`npm run dev:https` or `npm run start:local-prod`)
- THEN the script MUST start the Next.js server with HTTPS enabled.
- THEN it MUST use `next dev --experimental-https` or a custom HTTPS server wrapper.

### Requirement: Cloud Deployment Build Target
The project MUST provide placeholder npm commands for cloud deployment.

#### Scenario: Cloud Build & Deploy Scripts
- GIVEN the `package.json` is configured
- WHEN the cloud build and deploy commands are executed
- THEN the build command MUST generate production artifacts via `next build`.
- THEN the deploy command MUST act as a placeholder.