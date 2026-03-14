# CLAUDE.md

This file provides guidance to Claude Code when working with the Intel Ingester repository.

## Project

Intel Ingester is a fully-built, topic-driven intelligence synthesis platform on AWS. Define a topic, point it at sources (RSS, Reddit, YouTube, podcasts, PDFs), and receive an AI-synthesised briefing by email.

All implementation is on branch `feature/phase-0-infra-skeleton`. The `main` branch has only the initial skeleton commits.

## Architecture in one line

ECS Fargate workers → SQS → Lambda (embed + score) → Step Functions (collect + synthesise) → SES email

## Key decisions (do not change without good reason)

- **No VPC / No NAT Gateway** — all AWS services via IAM public endpoints; saves ~$32/mo idle cost
- **DynamoDB single-table** — 3 GSIs; ULID IDs; see `backend/shared/intel_shared/models/dynamo.py` for schema
- **Bedrock only** — Claude Sonnet 4.5 (synthesis), Haiku 4.5 (scoring), Titan Embed v2; model IDs in SSM
- **Zero idle cost** — Fargate and Bedrock only charge during active scans; no always-on compute
- **Single-user auth** — itsdangerous cookie + bcrypt + SSM; no Cognito

## Quick file map

| "I need to touch..." | "Look at..." |
|---|---|
| DynamoDB schema / models | `backend/shared/intel_shared/models/dynamo.py` |
| AWS client wrappers | `backend/shared/intel_shared/clients/` |
| Ingestion pipeline | `backend/workers/base/base_worker.py` + `workers/{type}/worker.py` |
| Chunk + embed | `backend/lambdas/processor/handler.py` |
| Relevance scoring | `backend/lambdas/scorer/handler.py` |
| Synthesis (Claude Sonnet) | `backend/lambdas/synthesiser/handler.py` |
| Email template | `backend/lambdas/emailer/templates/digest.html` |
| API endpoints | `backend/api/openapi.yaml` (spec) + `backend/api/app/routers/` |
| Scan trigger / SFN start | `backend/api/app/routers/topics.py` |
| CDK stacks | `infra/lib/stacks/` |
| Frontend pages | `frontend/src/app/` |
| Manual setup steps | `SETUP_TODO.md` |

## DynamoDB GSI2 note

GSI2 SK format is `{score:02d}#{createdAt}` (zero-padded). The collector queries `begins_with("06#")` through `begins_with("10#")` in 5 parallel threads. Do not change this format without updating the collector.

## Status transitions

Item status must always be updated atomically alongside the GSI1PK attribute:
- Worker → `RAW` (GSI1PK = `TOPIC#{id}#STATUS#RAW`)
- Processor → `EMBEDDED` (GSI1PK = `TOPIC#{id}#STATUS#EMBEDDED`)
- Scorer → `SCORED` (GSI1PK = `TOPIC#{id}#STATUS#SCORED`, GSI2PK + GSI2SK set)
