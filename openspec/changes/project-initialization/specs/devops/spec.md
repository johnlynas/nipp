# Delta for DevOps & Source Code Management

## ADDED Requirements

### Requirement: Source Code Management Platform
GitHub SHALL be used as the exclusive platform for source code management, version control, and code review.

#### Scenario: Repository Hosting
- GIVEN the project is initialized
- WHEN the code is committed and pushed
- THEN the central repository MUST be hosted on GitHub.

#### Scenario: Branch Protection
- GIVEN the GitHub repository is configured
- WHEN pull requests are created for the `main` branch
- THEN branch protection rules MUST be enabled, requiring at least one approval and passing CI checks before merging.

### Requirement: Continuous Integration and Deployment (CI/CD)
GitHub Actions SHALL be used for all automated CI/CD pipelines.

#### Scenario: Workflow Scaffolding
- GIVEN the project is initialized
- WHEN the `.github/workflows/` directory is created
- THEN it MUST contain `ci.yml` (for PR validation) and `deploy.yml` (for production deployment) boilerplate files.

#### Scenario: Node.js Version in CI
- GIVEN the GitHub Actions workflows are configured
- WHEN the workflows run
- THEN they MUST use Node.js 22.x via `actions/setup-node@v4` with `node-version: '22'`.
- THEN the CI environment MUST match the local development environment (Node 22 LTS).

### Requirement: Dependency Security Auditing
The CI pipeline MUST include automated dependency vulnerability scanning.

#### Scenario: npm audit in CI
- GIVEN a Pull Request is opened
- WHEN the CI workflow runs
- THEN it MUST execute `npm audit` and fail if vulnerabilities above a defined severity threshold (e.g., high or critical) are found.

### Requirement: Pre-Commit Hooks
The project MUST enforce code quality checks before commits via pre-commit hooks.

#### Scenario: Husky + lint-staged Configuration
- GIVEN the project is initialized
- WHEN a developer attempts to commit code
- THEN Husky MUST trigger a pre-commit hook.
- THEN lint-staged MUST run ESLint, Prettier, and TypeScript type-checking on staged files only.
- THEN the commit MUST be rejected if any checks fail.

### Requirement: Comprehensive .gitignore Configuration
The project MUST maintain a comprehensive `.gitignore` file that excludes all files containing secrets or sensitive data.

#### Scenario: Environment Files Exclusion
- GIVEN the project is initialized
- WHEN the `.gitignore` file is created
- THEN it MUST exclude:
  - `.env` (local development environment variables)
  - `.env.local` (Next.js local overrides)
  - `.env.local-prod` (local production environment variables)
  - `.env.*.local` (any environment-specific local files)
- THEN it MUST NOT exclude `.env.example` or `.env.local-prod.example` (these are safe to commit)

#### Scenario: Certificate Files Exclusion
- GIVEN the project uses TLS certificates for local-prod HTTPS
- WHEN the `.gitignore` file is created
- THEN it MUST exclude:
  - `certs/` directory (all TLS certificates and private keys)
  - `*.pem` (certificate files)
  - `*.key` (private key files)
  - `*.crt` (certificate files)
  - `*.p12` (PKCS#12 files)

#### Scenario: Database Files Exclusion
- GIVEN the project uses PostgreSQL
- WHEN the `.gitignore` file is created
- THEN it MUST exclude any legacy SQLite files:
  - `*.db` (SQLite database files)
  - `*.db-journal` (SQLite journal files)
  - `prisma/dev.db*` (Prisma SQLite files)

#### Scenario: Build Outputs and Dependencies Exclusion
- GIVEN the project generates build outputs and has dependencies
- WHEN the `.gitignore` file is created
- THEN it MUST exclude:
  - `node_modules/` (npm dependencies)
  - `.next/` (Next.js build output)
  - `dist/` (compiled output)
  - `out/` (static export)
  - `build/` (build output)
  - `coverage/` (test coverage reports)

#### Scenario: OS and IDE Files Exclusion
- GIVEN developers use different operating systems and IDEs
- WHEN the `.gitignore` file is created
- THEN it MUST exclude:
  - `.DS_Store` (macOS)
  - `Thumbs.db` (Windows)
  - `.idea/` (JetBrains IDEs)
  - `.vscode/` (VS Code, except recommended settings)
  - `*.swp`, `*.swo`, `*~` (editor swap files)

### Requirement: Pre-Commit Secret Detection
The project MUST implement a pre-commit hook that detects and prevents accidental commits of secrets.

#### Scenario: Secret Pattern Detection
- GIVEN a developer attempts to commit code
- WHEN the pre-commit hook runs
- THEN it MUST scan all staged files for patterns that look like secrets:
  - Private key headers (`-----BEGIN PRIVATE KEY-----`, `-----BEGIN RSA PRIVATE KEY-----`, etc.)
  - High-entropy strings (potential API keys, tokens)
  - AWS access key patterns (`AKIA[0-9A-Z]{16}`)
  - Database connection strings with passwords (`postgresql://.*:.*@`)
  - Common secret variable names with values (`SECRET=`, `PASSWORD=`, `API_KEY=`, etc.)
- THEN if a potential secret is detected, the commit MUST be blocked
- THEN a clear error message MUST be displayed explaining what was detected and how to fix it

#### Scenario: False Positive Handling
- GIVEN the secret detection hook is in place
- WHEN a file contains a pattern that looks like a secret but is actually safe (e.g., example values in documentation)
- THEN the developer MUST be able to bypass the check with an explicit flag (e.g., `git commit --no-verify`)
- THEN this bypass MUST be logged and discouraged

#### Scenario: Hook Integration with Husky
- GIVEN Husky is configured for pre-commit hooks
- WHEN the secret detection script is created
- THEN it MUST be integrated into the Husky pre-commit hook
- THEN it MUST run before other pre-commit checks (linting, formatting)
- THEN it MUST exit with a non-zero status code if secrets are detected

### Requirement: Example Environment Files
The project MUST provide example environment files with placeholder values for developers to reference.

#### Scenario: .env.example File
- GIVEN the project requires environment variables
- WHEN the `.env.example` file is created
- THEN it MUST contain all required environment variables with placeholder values
- THEN placeholder values MUST be clearly identifiable (e.g., `your-super-secret-key-change-in-production`)
- THEN comments MUST explain what each variable is for
- THEN the file MUST be safe to commit (no real secrets)

#### Scenario: .env.local-prod.example File
- GIVEN the project has a local production build target
- WHEN the `.env.local-prod.example` file is created
- THEN it MUST contain all production-like environment variables with placeholder values
- THEN it MUST include TLS certificate paths
- THEN it MUST be safe to commit (no real secrets)

#### Scenario: Developer Onboarding
- GIVEN a new developer is setting up the project
- WHEN they need to configure environment variables
- THEN they MUST be able to copy `.env.example` to `.env` and fill in real values
- THEN the README MUST document this process clearly