# Golden Agent — Architecture and Repository Organization Plan

## 1. Purpose

Golden Agent is a multi-model AI platform and autonomous execution environment. It must support hosted and local models, conversations, autonomous tasks, tools, files, multimodal processing, connected computers, workspaces, sharing, notifications, web, mobile, and strong authorization.

This document defines the repository organization before implementation begins. It is a target architecture, not an instruction to blindly create every empty directory.

## 2. Architectural decisions

| Area | Decision |
|---|---|
| Repository | Monorepo |
| Core API and business system | TypeScript/Node.js modular backend |
| AI orchestration and perception | Python service |
| Local computer access | Separate TypeScript connector application |
| Background work | Separate worker application using queues |
| Web client | Next.js/React/TypeScript |
| Mobile client | Flutter/Dart |
| Database | PostgreSQL |
| Queue/cache | Redis when needed |
| Files and artifacts | Storage abstraction; local development storage first, object storage later |
| Service communication | Versioned HTTP contracts initially; asynchronous queues for long-running work |
| Authorization authority | Core backend only |
| Model/provider support | Adapter interfaces; no provider-specific logic in controllers or workflows |

The architecture is modular, but it is not an unnecessarily fragmented microservice system. The backend remains one deployable modular application initially. The AI engine, connector, worker, web app, and mobile app are separate applications because they have different runtimes and operational responsibilities.

## 3. Target repository

```text
golden-agent/
├── apps/
│   ├── backend/                 # Core API, authorization, application data
│   ├── ai-engine/               # Python orchestration, routing, perception, model adapters
│   ├── connector/               # Runs on an authorized user computer
│   ├── worker/                  # Queues, scheduled jobs, background processing
│   ├── web/                     # Next.js web client
│   └── mobile/                  # Flutter mobile client
│
├── packages/
│   ├── api-client/              # Generated or shared client for backend APIs
│   ├── shared-types/             # Cross-application domain types where appropriate
│   ├── model-contracts/          # Model request/response/capability contracts
│   ├── tool-contracts/           # Tool definitions, schemas, permission metadata
│   ├── protocol/                 # Backend/AI-engine/connector protocol messages
│   ├── validation/               # Shared TypeScript validation utilities/schemas
│   ├── config-typescript/        # Shared TypeScript configuration
│   ├── config-eslint/            # Shared lint configuration
│   └── ui/                       # Shared web UI components only
│
├── infrastructure/
│   ├── database/                 # PostgreSQL setup, migration configuration, seed support
│   ├── docker/                   # Local development containers
│   ├── deployment/               # Deployment definitions
│   ├── reverse-proxy/            # Gateway/reverse-proxy configuration
│   ├── monitoring/               # Metrics, dashboards, health configuration
│   └── scripts/                  # Infrastructure-specific scripts
│
├── docs/
│   ├── architecture/             # System diagrams and boundaries
│   ├── api/                      # API and protocol documentation
│   ├── connector/                # Connector installation and security
│   ├── security/                 # Threat model, permissions, secret handling
│   ├── development/              # Local setup and coding rules
│   └── decisions/                # Architecture Decision Records
│
├── tests/
│   ├── integration/              # Cross-application integration tests
│   ├── end-to-end/               # User-flow tests
│   ├── security/                 # Authorization and security scenarios
│   └── fixtures/                 # Shared test data and sample files
│
├── scripts/
│   ├── development/              # Start, reset, seed, and local helper scripts
│   ├── build/                    # Build and verification scripts
│   └── release/                  # Release and packaging scripts
│
├── .github/workflows/            # CI/CD
├── .vscode/                      # Workspace settings
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── pyproject.toml
├── .env.example
├── .gitignore
└── README.md
```

Do not create a second repository or duplicate the existing top-level directories. First inspect the current repository and add only missing pieces.

## 4. Core backend structure

```text
apps/backend/
├── src/
│   ├── main.ts                    # Process entry point
│   ├── app.ts                     # Application composition and server setup
│   │
│   ├── config/                    # Environment and runtime configuration
│   ├── common/                    # Truly cross-cutting code only
│   │   ├── errors/
│   │   ├── logging/
│   │   ├── constants/
│   │   ├── types/
│   │   └── utilities/
│   ├── database/                  # Database client, transactions, migration wiring
│   │   ├── connections/
│   │   ├── transactions/
│   │   ├── migrations/
│   │   └── seeds/
│   ├── middleware/                # Auth extraction, validation, rate limiting, errors
│   ├── routes/                    # API version registration only
│   ├── events/                    # Internal domain/application events
│   ├── integrations/              # External adapters used by backend modules
│   ├── policies/                  # Shared authorization primitives, not business workflows
│   └── modules/
│       ├── auth/
│       ├── accounts/
│       ├── users/
│       ├── sessions/
│       ├── devices/
│       ├── account-linking/
│       ├── invitations/
│       ├── permissions/
│       ├── workspaces/
│       ├── sharing/
│       ├── conversations/
│       ├── files/
│       ├── providers/
│       ├── models/
│       ├── connectors/
│       ├── tasks/
│       ├── tools/
│       ├── notifications/
│       ├── audit/
│       ├── administration/
│       └── billing/               # Add only if billing is confirmed as a requirement
└── tests/
```

### Backend module template

Each module gets only the folders it actually needs. Do not create empty folders just to make every module look identical.

```text
modules/<module-name>/
├── routes/                        # HTTP endpoint definitions
├── controllers/                   # HTTP transport handlers; no database queries
├── services/                      # Business/application workflows
├── repositories/                  # Persistence queries and mapping
├── schemas/                       # Request, response, and validation schemas
├── policies/                      # Resource-specific authorization rules
├── types/                         # Module-specific types
├── errors/                        # Domain-specific errors
├── events/                        # Optional module events
└── index.ts                       # Public module composition/export
```

### Request flow

```text
HTTP request
  -> authentication middleware
  -> request validation
  -> authorization policy
  -> route
  -> controller
  -> service
  -> repository
  -> PostgreSQL
```

A controller translates HTTP into an application call and translates the result back into HTTP. A service owns the use case. A repository owns persistence. A policy answers whether the actor may perform an operation. No controller should contain SQL, model-provider calls, terminal execution, or a large business workflow.

## 5. Important backend ownership boundaries

- `accounts`, `auth`, `users`, `sessions`, and `devices` own identity and account access.
- `account-linking` handles secure linking of another personal device; it must not be treated as an invitation login.
- `invitations` creates and revokes invitations.
- `permissions` is the authorization foundation, but resource-specific decisions remain close to the owning module.
- `sharing` coordinates sharing resources without silently sharing unrelated conversations, files, devices, or terminals.
- `connectors` registers and tracks computers and their connection state; it does not execute local commands inside the backend.
- `models` represents model records, capabilities, availability, and access to models. It must distinguish a model from its host device and connector.
- `tasks` owns task records, lifecycle, approvals, cancellation, checkpoints, and execution references.
- `tools` owns tool metadata, schemas, permission requirements, and execution records. Actual local execution occurs through the connector when appropriate.
- `conversations` owns messages, attachments, context references, and conversation access.
- `files` owns metadata and storage references. Large content belongs in storage, not PostgreSQL rows.
- `audit` records security, authorization, sharing, connector, and important execution events.
- `notifications` turns state changes into user-visible notifications.

## 6. AI engine structure

```text
apps/ai-engine/
├── app/
│   ├── main.py
│   ├── application.py
│   ├── api/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── dependencies/
│   │   └── schemas/
│   ├── core/
│   │   ├── config.py
│   │   ├── logging.py
│   │   ├── exceptions.py
│   │   └── security.py
│   ├── orchestration/
│   │   ├── planners/
│   │   ├── executors/
│   │   ├── workflows/
│   │   ├── state/
│   │   └── verification/
│   ├── models/
│   │   ├── registry/
│   │   ├── capabilities/
│   │   ├── discovery/
│   │   ├── routing/
│   │   ├── adapters/
│   │   │   ├── hosted/
│   │   │   │   ├── openai/
│   │   │   │   ├── anthropic/
│   │   │   │   └── gemini/
│   │   │   ├── local/
│   │   │   │   ├── ollama/
│   │   │   │   └── custom_runtime/
│   │   │   └── compatible/
│   │   │       └── openai_compatible/
│   │   └── fallbacks/
│   ├── perception/
│   │   ├── images/
│   │   ├── documents/
│   │   ├── audio/
│   │   ├── video/
│   │   ├── websites/
│   │   ├── ocr/
│   │   └── context/
│   ├── agents/
│   │   ├── planning/
│   │   ├── coding/
│   │   ├── research/
│   │   ├── analysis/
│   │   └── collaboration/
│   ├── tools/
│   │   ├── registry/
│   │   ├── discovery/
│   │   ├── execution/
│   │   └── adapters/
│   ├── context/
│   │   ├── builders/
│   │   ├── memory/
│   │   ├── retrieval/
│   │   └── compression/
│   ├── services/
│   ├── repositories/
│   ├── schemas/
│   └── utilities/
└── tests/
    ├── unit/
    ├── integration/
    ├── evaluation/
    └── fixtures/
```

The AI engine may plan, route, process inputs, call approved tools, and verify results. It must not independently grant permissions, change account ownership, or bypass the core backend. The backend sends it a versioned request containing the task, authorized context, allowed operations, model constraints, and output requirements.

## 7. Connector structure

```text
apps/connector/
├── src/
│   ├── main.ts
│   ├── bootstrap/
│   ├── identity/
│   ├── pairing/
│   ├── connection/
│   ├── security/
│   ├── permissions/
│   ├── execution/
│   ├── models/
│   ├── tools/
│   ├── storage/
│   ├── diagnostics/
│   └── updates/
└── tests/
```

The connector receives typed, authorized operations rather than arbitrary commands from a model. It verifies the operation, checks local scope, enforces local permissions, executes it, and reports a truthful result. Model-use permission, terminal permission, filesystem permission, browser permission, and project permission are separate capabilities.

## 8. Worker, web, and mobile

```text
apps/worker/src/
├── main.ts
├── queues/
├── jobs/
├── schedules/
├── processors/
└── recovery/
```

The worker owns asynchronous processing, retries, scheduling, checkpoint recovery, timeout handling, and concurrency controls. It does not become a second business backend; it calls backend/application services or approved use-case modules.

```text
apps/web/src/
├── app/
├── components/
├── features/
├── layouts/
├── hooks/
├── services/
├── stores/
├── styles/
└── types/
```

```text
apps/mobile/lib/
├── app/
├── core/
├── features/
├── navigation/
├── services/
├── state/
└── widgets/
```

Web and mobile contain presentation and client-state logic. They do not duplicate authorization or business rules. Both use the same backend contracts and represent the difference between proposed, awaiting approval, running, succeeded, failed, paused, and cancelled states.

## 9. Cross-application contracts

Define these before implementing complex business logic:

1. Backend API request/response and error format.
2. AI-engine task request and structured result format.
3. Connector command, authorization context, progress event, and result format.
4. Model capability and provider-adapter contracts.
5. Task lifecycle and event contracts.
6. File and artifact reference format.

Each request must carry explicit identifiers such as account, actor, workspace, conversation, task, execution, connector, and model connection where relevant. This prevents concurrent users, devices, conversations, and shared models from being mixed.

## 10. Dependency rules

1. Routes call controllers; controllers call services; services call repositories and integrations.
2. Repositories do not call controllers or depend on HTTP.
3. Controllers do not contain SQL, queue implementation, provider-specific logic, or authorization decisions hidden in conditionals.
4. Provider adapters implement common interfaces and are selected by the model-routing layer.
5. The AI engine never becomes an alternate authentication or authorization path.
6. The connector never trusts model-generated commands without validation and permission checks.
7. Shared packages contain contracts and reusable infrastructure, not arbitrary business logic copied from the backend.
8. A module may call another module through its public service/interface, not by reaching into private files.
9. Database ownership stays in the core backend. Other applications access application capabilities through contracts.
10. Every externally visible operation must produce truthful status and error information.

## 11. Implementation order without reducing scope

The product remains fully in scope, but implementation should follow dependencies:

1. Inspect and preserve the existing repository.
2. Establish workspace tooling, environment configuration, linting, formatting, and test commands.
3. Define shared contracts and error/status conventions.
4. Establish PostgreSQL migrations, storage abstraction, logging, and health checks.
5. Implement authentication, accounts, sessions, devices, account linking, invitations, permissions, and audit records.
6. Implement workspaces, conversations, files, providers, models, capabilities, and connector registry.
7. Implement connector pairing, secure outbound connection, permissioned execution, and model discovery.
8. Implement AI-engine API, provider adapters, capability-aware routing, perception, orchestration, tool execution, and verification.
9. Implement task lifecycle, queues, scheduling, checkpoints, retries, cancellation, and notifications.
10. Implement web and mobile features against the established contracts.
11. Add integration, security, recovery, and end-to-end tests continuously.
12. Add deployment, monitoring, diagnostics, backup, and release automation.

A feature is only complete when its backend behavior, authorization, failure handling, UI behavior, and relevant tests exist.

## 12. What must happen before file creation

1. Inspect the actual repository tree and existing files.
2. Identify which proposed folders already exist and whether they contain work.
3. Decide the exact database/ORM and queue libraries.
4. Decide the exact authentication/session strategy.
5. Decide whether Flutter mobile is already initialized and preserve it if so.
6. Review the existing package manifests before changing tooling.
7. Create the contracts and architecture decision records.
8. Then create only the required directories and starter files.

The next safe command on the existing Windows repository is:

```cmd
cd /d C:\Users\Administrator\golden-agent
tree /A /F
```

Do not delete or overwrite the current project until its contents have been inspected.
