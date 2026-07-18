# Specification, Design & Implementation Process

This document describes the end-to-end process used in the Property NI Multi-Tenant Portal for specifying, designing, implementing, and testing new features using **OpenSpec** (Specification-Driven Development).

---

## Table of Contents

1. [Overview](#overview)
2. [OpenSpec Fundamentals](#openspec-fundamentals)
3. [The Feature Lifecycle](#the-feature-lifecycle)
4. [Phase 1: Proposal](#phase-1-proposal)
5. [Phase 2: Design](#phase-2-design)
6. [Phase 3: Task Breakdown](#phase-3-task-breakdown)
7. [Phase 4: Implementation](#phase-4-implementation)
8. [Phase 5: Testing](#phase-5-testing)
9. [Phase 6: Review & Merge](#phase-6-review--merge)
10. [Phase 7: Archival](#phase-7-archival)
11. [Directory Structure](#directory-structure)
12. [Best Practices](#best-practices)

---

## Overview

The Property NI project uses **OpenSpec** to manage feature development through a structured, document-driven workflow. This approach ensures that every feature is:

- **Well-specified** — Clear requirements and acceptance criteria before any code is written
- **Properly designed** — Technical decisions are documented and reviewed
- **Incrementally implemented** — Work is broken into manageable tasks
- **Thoroughly tested** — Tests are defined alongside specifications
- **Traceable** — Every change is tracked from idea to completion

### When to Use OpenSpec

Use an OpenSpec proposal for any feature that:

- Introduces new functionality or capabilities
- Modifies existing architecture or data models
- Impacts security, performance, or user experience significantly
- Requires coordination across multiple components

**Simple bug fixes and minor tweaks** may not require a full OpenSpec proposal — use your judgment based on impact.

---

## OpenSpec Fundamentals

### Schema: `spec-driven`

This project uses the **spec-driven** schema, which emphasizes writing detailed specifications (acceptance criteria) that guide implementation.

### Core Concepts

| Concept | Description |
|---------|-------------|
| **Change** | A unit of work representing a feature or improvement. Each change has its own directory under `openspec/changes/<name>/`. |
| **Proposal** | The "what" and "why" — describes the problem, motivation, scope, and acceptance criteria. |
| **Design** | The "how" — technical architecture, data flow, and implementation decisions. |
| **Tasks** | The "steps" — granular, actionable items that guide implementation. |
| **Spec** | The "requirements" — formal acceptance criteria organized by capability area. |

### Change Statuses

| Status | Meaning |
|--------|---------|
| `proposed` | The change has been proposed but not yet started. |
| `in-progress` | Implementation is underway. Tasks are being completed. |
| `completed` | All tasks are done, tests pass, and the change is ready for archival. |

---

## The Feature Lifecycle

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  PROPOSAL   │────▶│    DESIGN   │────▶│    TASKS    │
│  (What & Why)│     │  (How)      │     │ (Steps)     │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                       │
       ▼                                       ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    SPECS    │◀────│ IMPLEMENT   │────▶│    TEST     │
│ (Requirements)│    │  (Code)     │     │  (Verify)   │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                       │
       ▼                                       ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  REVIEW &   │────▶│    MERGE    │────▶│  ARCHIVAL   │
│  APPROVAL   │     │  (main)     │     │ (Archive)   │
└─────────────┘     └─────────────┘     └─────────────┘
```

---

## Phase 1: Proposal

The proposal is the starting point for any feature. It answers **what** we're building and **why**.

### Creating a New Change

```bash
# Create a new change directory
openspec new-change <change-name> "<brief description>"

# Example:
openspec new-change content-security-policy "Harden CSP with nonce-based approach"
```

### Proposal Structure (`proposal.md`)

Every proposal must include the following sections:

#### 1. Header Metadata

```markdown
# Feature Name

**Status:** Proposed  
**Author:** Your Name  
**Created:** YYYY-MM-DD  
**Last Updated:** YYYY-MM-DD  
**Related Issues:** #123, Security initiative
```

#### 2. Summary

A concise 2-4 sentence overview of the feature and its primary goal.

#### 3. Motivation

Explain **why** this feature is needed:
- What problem does it solve?
- What are the current limitations or pain points?
- What benefits will users/stakeholders receive?

#### 4. Scope

**In scope:**
- List what IS included in this change

**Out of scope (Non-goals):**
- List what is explicitly NOT included
- This prevents scope creep

#### 5. Detailed Design Overview

Provide a high-level technical approach:
- Key architectural decisions
- Major components to create or modify
- Data flow considerations

#### 6. Files to Create or Modify

| Type | File Path | Purpose |
|------|-----------|---------|
| New | `lib/new-feature.ts` | Core implementation |
| Modified | `middleware.ts` | Add new middleware logic |

#### 7. Testing Plan

Describe how the feature will be tested:
- Unit tests to write
- Integration tests needed
- Manual testing scenarios
- Security/performance considerations

#### 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing functionality | High | Use feature flags, deploy to staging first |

#### 9. Acceptance Criteria

List the conditions that must be met for this feature to be considered complete:
- [ ] Criterion 1
- [ ] Criterion 2

---

## Phase 2: Design

The design document answers **how** the feature will be implemented technically. This is where deep technical thinking happens before any code is written.

### Design Structure (`design.md`)

#### 1. Architecture Overview

Describe the overall architecture:
- System components involved
- How they interact
- Data flow diagrams (if applicable)

#### 2. Technical Decisions

Document key decisions with rationale:

```markdown
### Decision 1: Use Web Crypto API for nonce generation

**Context:** Middleware runs on Edge runtime which doesn't support Node's `crypto.randomBytes`.

**Decision:** Use Web Crypto API (`crypto.getRandomValues`).

**Rationale:** 
- Edge runtime compatible
- Cryptographically secure
- No additional dependencies needed

**Alternatives considered:**
- Node.js `crypto.randomBytes` — rejected (Edge incompatible)
- Third-party library — rejected (unnecessary dependency)
```

#### 3. Data Flow

Describe how data moves through the system:

1. **Request Ingress** → HTTP request hits middleware
2. **Processing** → Nonce generated, headers set
3. **Response** → CSP header included in response

#### 4. Component Specifications

For each component, describe:
- Purpose
- Inputs/outputs
- Key methods/functions
- Dependencies

#### 5. Security Considerations

If the feature impacts security:
- Threat model analysis
- Encryption requirements
- Authentication/authorization implications

#### 6. Performance Considerations

- Expected performance impact
- Caching strategies
- Database query optimization

#### 7. API Specifications

If new APIs are introduced:

```typescript
// Example API contract
interface UserResponse {
  id: string;
  email: string;
  organizationId: string;
}

// GET /api/users/:id
// Response: UserResponse
```

---

## Phase 3: Task Breakdown

Tasks break the implementation into small, actionable steps that can be completed in isolation.

### Task Structure (`tasks.md`)

#### Organize by Phase

Group tasks into logical phases that build upon each other:

```markdown
# Tasks: Content Security Policy Hardening

## Phase 1: Foundation & Report-Only Mode
- [ ] **Task 1.1:** Create `lib/csp-nonce.ts` with the `generateNonce()` function
- [ ] **Task 1.2:** Update `middleware.ts` to import the nonce generator
- [ ] **Task 1.3:** Generate nonce per request and set on headers

## Phase 2: React Integration
- [ ] **Task 2.1:** Update `app/layout.tsx` to read nonce from headers
- [ ] **Task 2.2:** Pass nonce to inline scripts and styles

## Phase 3: Testing & Validation
- [ ] **Task 3.1:** Run app locally and check browser console for CSP violations
- [ ] **Task 3.2:** Navigate through all pages and verify functionality

## Phase 4: Enforcement & Deployment
- [ ] **Task 4.1:** Switch from Report-Only to enforcement mode
- [ ] **Task 4.2:** Deploy to staging for monitoring
```

### Task Guidelines

| Guideline | Description |
|-----------|-------------|
| **Atomic** | Each task should be completable in a single focused effort (ideally < 2 hours) |
| **Ordered** | Tasks should be listed in execution order; later tasks depend on earlier ones being complete |
| **Verifiable** | Each task should have a clear "done" state that can be verified |
| **Specific** | Use precise language — include file paths, function names, and expected outcomes |

### Task Naming Convention

```markdown
- [ ] **Task X.Y:** Brief description of what to do — include specific file/function names
```

---

## Phase 4: Implementation

This is where the actual code is written. Follow these guidelines for effective implementation.

### Before You Start

1. **Review all artifacts** — Read the proposal, design, and tasks
2. **Create a feature branch** — Use descriptive naming: `feature/<change-name>`
3. **Understand dependencies** — Identify which tasks depend on others

### Implementation Workflow

```bash
# 1. Create and switch to feature branch
git checkout -b feature/content-security-policy

# 2. Complete tasks one at a time
# For each task:
#   a. Understand the requirement from tasks.md
#   b. Implement the code
#   c. Write/update tests
#   d. Commit with descriptive message

git add .
git commit -m "feat: implement CSP nonce generation utility"

# 3. Run tests frequently
npm test
npm run type-check

# 4. Push and create PR when all tasks are complete
git push origin feature/content-security-policy
```

### Code Quality Standards

| Standard | Enforcement |
|----------|-------------|
| **TypeScript strict mode** | `tsc --noEmit` must pass |
| **ESLint rules** | `npm run lint` must pass with no errors |
| **Prettier formatting** | Files formatted on save via `.prettierrc` |
| **Tenant isolation** | Use `lib/tenant-db.ts`, never direct `prisma` imports in business logic |
| **Security** | No secrets in code, use environment variables |

### Commit Message Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

**Examples:**
```bash
feat(auth): add Google OAuth social login provider
fix(api): resolve tenant isolation bypass in user queries
docs: update CSP implementation guide
test(isolation): add integration tests for RLS policies
```

---

## Phase 5: Testing

Testing is integral to the OpenSpec process. Tests should be written alongside implementation, not after.

### Test Types

| Type | Location | Purpose |
|------|----------|---------|
| **Unit Tests** | `tests/unit/` | Test individual functions and components in isolation |
| **Integration Tests** | `tests/integration/` | Test interactions between components with real dependencies |
| **E2E Tests** | `tests/e2e/` (if applicable) | Test complete user flows through the application |

### Writing Tests That Match Specifications

Each spec requirement should have corresponding tests:

```markdown
# From specs/security/spec.md

### Requirement 1: Nonce-Based CSP
- [ ] A unique cryptographic nonce is generated for every HTTP request

# Corresponding test in tests/unit/csp-nonce.test.ts
describe('generateNonce', () => {
  it('should generate a unique nonce for each call', () => {
    const nonce1 = generateNonce();
    const nonce2 = generateNonce();
    expect(nonce1).not.toBe(nonce2);
  });

  it('should generate a 32-character hex string', () => {
    const nonce = generateNonce();
    expect(nonce).toHaveLength(32);
    expect(nonce).toMatch(/^[0-9a-f]+$/);
  });
});
```

### Test Execution Commands

```bash
# Run all unit tests (fast, no running system needed)
npm test

# Watch mode — re-runs on file changes
npm run test:watch

# Integration tests (needs PostgreSQL + Redis running)
npm run test:integration

# All tests combined
npm run test:all

# With coverage report
npm run test:coverage
```

### Testing Checklist for Each Feature

- [ ] Unit tests cover all new functions and utilities
- [ ] Integration tests verify component interactions
- [ ] Edge cases are tested (null inputs, empty arrays, etc.)
- [ ] Error handling paths are covered
- [ ] Security tests verify no regressions (XSS, injection, etc.)
- [ ] Tenant isolation tests pass for organization-scoped features

---

## Phase 6: Review & Merge

Before merging, ensure the change meets all quality gates.

### Pre-Merge Checklist

| Check | Command/Action |
|-------|----------------|
| All tasks completed | Review `tasks.md` — all checkboxes checked |
| Tests pass | `npm run test:all` |
| Type checking passes | `npm run type-check` |
| Linting passes | `npm run lint` |
| No secrets committed | Pre-commit hook should have caught this |
| Documentation updated | README, API docs, etc. |
| Spec requirements met | Review `specs/*/spec.md` acceptance criteria |

### Pull Request Template

When creating a PR, include:

```markdown
## Summary
Brief description of the change and its purpose.

## Related OpenSpec Change
- Change: `openspec/changes/<change-name>/`
- Proposal: [Link to proposal.md](../openspec/changes/<change-name>/proposal.md)

## Changes Made
- List key changes
- New files created
- Files modified

## Testing Performed
- Unit tests: All passing
- Integration tests: All passing
- Manual testing scenarios completed

## Screenshots (if UI changes)
[Add screenshots]

## Security Considerations
[Any security implications or mitigations]
```

---

## Phase 7: Archival

Once a change is merged and verified in production, archive it to keep the `openspec/changes` directory clean.

### Archiving a Change

```bash
# Archive the change and update main specs
openspec archive <change-name>
```

### What Archival Does

1. Moves the change directory to `openspec/archive/`
2. Updates any main specs that were affected by the change
3. Preserves the complete history for future reference

### When to Archive

Archive a change when:
- ✅ All tasks are completed and verified
- ✅ The feature is merged into `main`
- ✅ The feature has been tested in staging/production
- ✅ No regressions have been reported

---

## Directory Structure

```
openspec/
├── config.yaml                    # OpenSpec configuration (schema, rules)
├── changes/                       # Active change proposals
│   ├── <change-name>/            # Each feature gets its own directory
│   │   ├── .openspec.yaml        # Change metadata (status, artifacts)
│   │   ├── proposal.md           # What & Why
│   │   ├── design.md             # How (technical design)
│   │   ├── tasks.md              # Implementation steps
│   │   └── specs/                # Formal specifications
│   │       ├── <capability>/     # One directory per capability area
│   │       │   └── spec.md       # Requirements & acceptance criteria
│   │       ├── security/
│   │       │   └── spec.md
│   │       └── auth/
│   │           └── spec.md
│   ├── content-security-policy/  # Example: CSP hardening change
│   ├── auth-and-rbac/            # Example: Authentication & RBAC
│   └── project-initialization/   # Example: Initial project setup
└── archive/                      # Completed/archived changes (created on archive)
```

### Artifact Files Reference

| File | Purpose | When to Create/Update |
|------|---------|----------------------|
| `.openspec.yaml` | Change metadata and status | Created when change is initiated |
| `proposal.md` | Feature proposal with motivation, scope, acceptance criteria | Created first — before any design work |
| `design.md` | Technical architecture and implementation decisions | Created after proposal is approved |
| `tasks.md` | Granular implementation tasks | Created after design is complete |
| `specs/<name>/spec.md` | Formal requirements with acceptance criteria | Created alongside or after design |

---

## Best Practices

### For Proposals

1. **Start with the user problem** — Always explain why before what
2. **Define clear scope boundaries** — Explicitly state what's out of scope
3. **Include a testing plan early** — Don't leave testing for after implementation
4. **Identify risks upfront** — Document potential issues and mitigations

### For Designs

1. **Document decisions, not just code** — Explain the "why" behind technical choices
2. **Consider alternatives** — Show you've evaluated other approaches
3. **Include data flow diagrams** — Visual representations help understanding
4. **Address security explicitly** — Don't assume it's covered elsewhere

### For Tasks

1. **Break down aggressively** — If a task feels big, break it into smaller pieces
2. **Order matters** — Tasks should be executable in sequence
3. **Include verification steps** — Each task should have a clear "done" state
4. **Reference specs** — Link tasks back to specific requirements

### For Implementation

1. **Follow the task order** — Don't skip ahead; dependencies matter
2. **Test as you go** — Write tests alongside code, not after
3. **Commit frequently** — Small, focused commits are easier to review
4. **Update documentation** — Keep specs and docs in sync with code

### For Testing

1. **Test requirements, not just code** — Each spec requirement should have tests
2. **Include negative test cases** — Test error paths and edge cases
3. **Automate everything possible** — Manual tests should be the exception
4. **Run full test suite before PR** — Don't rely on partial test runs

### For Reviews

1. **Review artifacts before code** — Understand the intent before reviewing implementation
2. **Check task completion** — Verify all tasks in `tasks.md` are addressed
3. **Verify spec compliance** — Ensure acceptance criteria from specs are met
4. **Look for security implications** — Even small changes can have security impacts

---

## Quick Reference: Creating a New Feature

```bash
# 1. Create the change directory
openspec new-change my-new-feature "Description of the feature"

# 2. Write the proposal
# Edit openspec/changes/my-new-feature/proposal.md

# 3. Create the design
# Edit openspec/changes/my-new-feature/design.md

# 4. Break down into tasks
# Edit openspec/changes/my-new-feature/tasks.md

# 5. Define specifications (if needed)
mkdir -p openspec/changes/my-new-feature/specs/capability-name
# Edit openspec/changes/my-new-feature/specs/capability-name/spec.md

# 6. Update .openspec.yaml status as you progress
# Edit openspec/changes/my-new-feature/.openspec.yaml

# 7. Implement tasks, write tests
git checkout -b feature/my-new-feature
# ... implement and test ...

# 8. Create PR, get review, merge to main

# 9. Archive when complete
openspec archive my-new-feature
```

---

## Examples from This Project

### Example 1: Content Security Policy Hardening

- **Change:** `content-security-policy`
- **Proposal:** Replaced permissive CSP with nonce-based approach
- **Design:** Edge runtime nonce generation, middleware injection, RSC consumption
- **Tasks:** 4 phases from foundation to production deployment
- **Specs:** Security spec with 4 requirements and detailed acceptance criteria

### Example 2: Project Initialization

- **Change:** `project-initialization`
- **Proposal:** Established foundation with UI/UX & Security First approach
- **Design:** Multi-layered architecture with tenant isolation defense-in-depth
- **Tasks:** Comprehensive setup across infrastructure, security, and development tooling
- **Specs:** 9 specification areas (architecture, auth, build, database, devops, multi-tenancy, security, testing, UI)

### Example 3: Super Admin Organization Management

- **Change:** `super-admin-org-mgmt`
- **Proposal:** CRUD operations for tenant organizations with state machine lifecycle
- **Design:** Organization states (PENDING → ACTIVE ↔ SUSPENDED → ARCHIVED)
- **Tasks:** API routes, UI components, validation, and testing
- **Specs:** Organization management spec with lifecycle requirements

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| OpenSpec commands not found | Ensure `openspec` CLI is installed: `npm install -g openspec-cli` |
| Validation errors | Run `openspec validate <change-name>` to see detailed issues |
| Missing artifacts | Check `.openspec.yaml` lists all required artifacts |
| Spec not found | Ensure spec directory structure matches: `specs/<capability>/spec.md` |

### Getting Help

- Review existing changes in `openspec/changes/` for examples
- Check `openspec/config.yaml` for project-specific rules
- Use `openspec show <change-name>` to view change details

---

*This document describes the process used by the Property NI Multi-Tenant Portal. Adapt it to your project's needs while maintaining the core principles of specification-driven development.*
