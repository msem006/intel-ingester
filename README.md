# Intel Ingester

A personal, topic-driven intelligence synthesis platform. Define a topic, point it at sources (RSS, Reddit, YouTube, podcasts, PDFs), and receive an AI-synthesised briefing in your inbox. Runs entirely on AWS — costs nothing when idle, ~$4 per scan.

## What it does

1. **Ingest** — Fargate workers pull content from configured sources (RSS feeds, subreddits, YouTube channels, podcast feeds, PDFs, manual paste)
2. **Process** — Lambda chunks content, embeds via Bedrock Titan Embed, scores relevance via Claude Haiku
3. **Synthesise** — Step Functions orchestrates Claude Sonnet to produce a structured intelligence briefing (trends, insights, signals, quotes)
4. **Deliver** — Email digest via SES + web dashboard via Next.js

## Architecture

```
USER → Dashboard (Next.js, CloudFront/S3)
         ↓ API calls (X-API-Key)
       API Gateway HTTP → FastAPI Lambda
         ↓ RunTask / StartExecution
       ECS Fargate workers (on-demand, exit when done)
         ↓ SQS to-process
       Processor Lambda (chunk + embed via Bedrock Titan)
         ↓ SQS to-score
       Scorer Lambda (relevance score via Claude Haiku)
         ↓ Step Functions trigger
       Step Functions Standard Workflow
         → Collector Lambda (gather SCORED items ≥ 6)
         → Synthesiser Lambda (Claude Sonnet synthesis)
         → SNS → Emailer Lambda → SES → inbox
       All state in DynamoDB (single-table) + S3 (raw content + embeddings)
```

**Cost philosophy:** Zero baseline when idle. All compute (Fargate, Lambda, Bedrock, Transcribe) charges only accrue during active scans. No NAT Gateway, no RDS, no always-on servers.

## Stack

| Layer | Technology |
|---|---|
| IaC | AWS CDK (TypeScript) |
| Backend API | Python 3.12, FastAPI, Mangum (Lambda adapter) |
| Ingestion workers | Python 3.12, ECS Fargate (on-demand) |
| AI inference | Amazon Bedrock (Claude Sonnet synthesis, Haiku scoring, Titan Embed) |
| Audio transcription | Amazon Transcribe (IAM role, no API key) |
| Database | DynamoDB single-table, on-demand billing |
| Object store | S3 (raw content + embeddings) |
| Auth | SSM Parameter Store + itsdangerous session cookie (no Cognito) |
| Secrets | AWS Secrets Manager (Reddit, YouTube API keys) |
| Email | Amazon SES + Jinja2 HTML template |
| Orchestration | Step Functions Standard Workflow |
| Frontend | Next.js 15, TanStack Query, Tailwind CSS |

## Repository structure

```
intel-ingester/
├── infra/                          CDK infrastructure (TypeScript)
│   └── lib/stacks/
│       ├── storage-stack.ts        S3 buckets + DynamoDB single-table (3 GSIs)
│       ├── ssm-auth-stack.ts       SSM params: password hash, API key, session secret
│       ├── secrets-stack.ts        Secrets Manager (Reddit, YouTube) + config SSM params
│       ├── ingestion-stack.ts      ECS cluster, 6 Fargate task defs, SQS queues + DLQs
│       ├── email-stack.ts          SNS digest topic, SES config set, emailer Lambda
│       ├── synthesis-stack.ts      Step Functions + processor/scorer/collector/synthesiser Lambdas
│       ├── api-stack.ts            API Gateway HTTP + FastAPI Lambda
│       ├── frontend-stack.ts       S3 + CloudFront OAC
│       └── observability-stack.ts  CloudWatch dashboard, DLQ alarms, AWS Budgets $50/mo
│
├── backend/
│   ├── shared/intel_shared/        Shared Python package (pip install -e)
│   │   ├── models/dynamo.py        DynamoDB schema: Pydantic models, key builders, GSI builders
│   │   ├── clients/                AWS wrappers: bedrock.py, dynamo.py, s3.py, secrets.py
│   │   └── utils/                  text.py (chunking, hashing), config.py (SSM loader)
│   ├── api/
│   │   ├── openapi.yaml            OpenAPI 3.1 spec (source of truth for API contract)
│   │   └── app/                    FastAPI app: main.py, auth.py, middleware.py, routers/
│   ├── workers/
│   │   ├── base/base_worker.py     Abstract base: dedup → S3 → DynamoDB → SQS pipeline
│   │   ├── rss/                    feedparser + trafilatura
│   │   ├── reddit/                 PRAW + top comment extraction
│   │   ├── youtube/                Data API v3 + youtube-transcript-api
│   │   ├── podcast/                feedparser + Amazon Transcribe
│   │   ├── pdf/                    pdfplumber
│   │   └── manual/                 paste/URL ingestion (LinkedIn workaround)
│   └── lambdas/
│       ├── processor/              SQS-triggered: chunk + Titan embed → S3
│       ├── scorer/                 SQS-triggered: Claude Haiku relevance score 0–10
│       ├── collector/              Step Functions state 1+2: gather + assemble context window
│       ├── synthesiser/            Step Functions state 3+4: Claude Sonnet synthesis + DynamoDB write
│       └── emailer/                SNS-triggered: Jinja2 HTML render + SES send
│
└── frontend/
    └── src/
        ├── app/                    Next.js pages: login, dashboard, topics, digests, settings
        ├── components/             Nav, SourceBadge, StatusBadge, Spinner
        └── lib/                    api.ts (fetch client), hooks.ts (TanStack Query), types.ts
```

## DynamoDB single-table schema

**Table:** `IntelIngester` | On-demand | TTL: `ttl` | PK + SK (both String)

| Entity | PK | SK |
|--------|----|----|
| User | `USER#main` | `PROFILE` |
| Topic | `USER#main` | `TOPIC#{topicId}` |
| Source | `TOPIC#{topicId}` | `SOURCE#{sourceId}` |
| Item | `TOPIC#{topicId}` | `ITEM#{itemId}` |
| Chunk | `ITEM#{itemId}` | `CHUNK#{index:04d}` |
| Digest | `TOPIC#{topicId}` | `DIGEST#{digestId}` |

| GSI | PK | SK | Purpose |
|-----|----|----|---------|
| GSI1 | `TOPIC#{id}#STATUS#{status}` | `{createdAt}` | Items by status (processor/scorer hot path) |
| GSI2 | `TOPIC#{id}` | `{score:02d}#{createdAt}` | Items by score+date (collector, 5 parallel queries) |
| GSI3 | `HASH#{sha256}` | `TOPIC#{id}` | Content dedup across sources |

IDs: ULIDs everywhere (`python-ulid`). Lexicographic = chronological — no separate sort fields needed.

## Data flow

```
Run Scan (API POST /topics/{id}/scan)
  → ECS RunTask per enabled source (passes TOPIC_ID + SOURCE_ID env vars)
  → Worker: fetch → dedup (GSI3) → S3 write → DynamoDB (status=RAW) → SQS to-process
  → Processor Lambda: clean → chunk (512 tokens, 50 overlap) → Titan embed → S3
                       DynamoDB status=EMBEDDED → SQS to-score
  → Scorer Lambda: Claude Haiku relevance 0–10 → DynamoDB status=SCORED (GSI1PK + GSI2SK updated)

Synthesise (API POST /topics/{id}/synthesise → Step Functions)
  → Collector: 5 parallel GSI2 queries (scores 6–10) → assemble up to 50K tokens
  → Synthesiser: Claude Sonnet prompt → structured JSON digest → DynamoDB
  → SNS Notify → Emailer Lambda → Jinja2 dark HTML → SES
```

## Auth

Single-user tool. No Cognito.
- **Browser sessions:** itsdangerous TimestampSigner cookie (`intel_session`, 24h TTL)
- **API calls:** `X-API-Key` header validated against SSM param `/intel-ingester/prod/auth/api-key`
- **Password:** bcrypt hash stored in SSM `/intel-ingester/prod/auth/password`
- All routes except `/auth/login`, `/auth/logout`, `/health` require both cookie + API key

## Deployed instance

| Resource | Value |
|---|---|
| Frontend | `https://d2ajsxi49l5yby.cloudfront.net` |
| API | `https://kwndxo6eq9.execute-api.ap-southeast-2.amazonaws.com` |
| AWS account | `immutable-customer-ops` (911167921899) |
| Region | `ap-southeast-2` (Sydney) |
| AWS profile | `imx-admin` |

## Setup

See **[SETUP_TODO.md](SETUP_TODO.md)** for the full step-by-step checklist.

### Completed setup (as of March 2026)

- [x] CDK bootstrap + all 9 stacks deployed
- [x] Auth SSM params configured (password, session secret, API key)
- [x] SES sending email verified (`dhanish.semar@immutable.com`)
- [x] All 6 Docker worker images built via CodeBuild and pushed to ECR
- [x] ECS task definition families registered with real ECR images
- [x] Frontend built and deployed to S3/CloudFront
- [ ] Reddit API credentials (optional — add when needed)
- [ ] YouTube API credentials (optional — add when needed)

## Cost

| Scenario | Estimated monthly cost |
|---|---|
| Baseline (no scans) | ~$8–15 |
| Weekly scans (1 topic, ~50 articles + 5 podcasts) | ~$25–30 |
| Daily scans | ~$120–130 |

Biggest per-scan cost: Transcribe (~$0.015/min × 45 min × 5 episodes ≈ $3.20). Skip podcast sources to reduce cost significantly.
