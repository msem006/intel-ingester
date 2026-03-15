# Intel Ingester — Manual Setup Checklist

Work through these steps in order. Everything before "After deploy" requires `cdk deploy --all` to have run successfully.

---

## Before deploying

### 1. AWS credentials
```bash
aws configure
# OR set environment variables:
export CDK_DEFAULT_ACCOUNT=<your-aws-account-id>
export CDK_DEFAULT_REGION=ap-southeast-2   # or your preferred region
```

### 2. CDK bootstrap (one-time per account/region)
```bash
cd infra
npm install
npx cdk bootstrap
```

### 3. Deploy all stacks
```bash
npx cdk deploy --all
```

Note the outputs — you'll need:
- `ApiStack` → `ApiUrl` (API Gateway URL)
- `FrontendStack` → `DistributionUrl` + `SiteBucketName`
- `ObservabilityStack` → `AlertTopicArn`

---

## After deploying

### 4. Set auth credentials in SSM

Generate a bcrypt hash of your login password:
```bash
python3 -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_PASSWORD', bcrypt.gensalt()).decode())"
```

Generate a session secret:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Set them in SSM:
```bash
aws ssm put-parameter \
  --name /intel-ingester/prod/auth/password \
  --value '<bcrypt-hash-output>' \
  --type String --overwrite

aws ssm put-parameter \
  --name /intel-ingester/prod/auth/api-key \
  --value '<choose-a-random-string>' \
  --type String --overwrite

aws ssm put-parameter \
  --name /intel-ingester/prod/auth/session-secret \
  --value '<32-byte-hex-from-above>' \
  --type String --overwrite
```

- [x] auth/password set
- [x] auth/api-key set
- [x] auth/session-secret set

---

### 5. SES email setup

1. Go to **AWS Console → SES → Verified identities** → click **Create identity**
2. Verify your sending email address (you'll receive a confirmation email)
3. If you want to send to any address (not just verified ones), submit a **production access request** in the SES console to exit sandbox mode

Update SSM with your verified addresses:
```bash
aws ssm put-parameter \
  --name /intel-ingester/prod/config/ses-from-email \
  --value 'you@yourdomain.com' \
  --type String --overwrite

aws ssm put-parameter \
  --name /intel-ingester/prod/config/ses-to-email \
  --value 'you@yourdomain.com' \
  --type String --overwrite
```

- [x] Sending email address verified in SES
- [ ] SES sandbox exit requested (or sending only to verified addresses)
- [x] ses-from-email SSM param updated
- [x] ses-to-email SSM param updated

---

### 6. Third-party API credentials

**Reddit** (get credentials at https://www.reddit.com/prefs/apps → create app → "script" type):
```bash
aws secretsmanager put-secret-value \
  --secret-id /intel-ingester/prod/reddit \
  --secret-string '{"client_id":"<id>","client_secret":"<secret>","user_agent":"intel-ingester/1.0 (by u/yourusername)"}'
```
- [ ] Reddit app created at reddit.com/prefs/apps
- [ ] Reddit secret updated in Secrets Manager

**YouTube** (get API key at https://console.cloud.google.com → APIs & Services → Credentials → YouTube Data API v3):
```bash
aws secretsmanager put-secret-value \
  --secret-id /intel-ingester/prod/youtube \
  --secret-string '{"api_key":"<your-api-key>"}'
```
- [ ] YouTube Data API v3 enabled in Google Cloud Console
- [ ] YouTube secret updated in Secrets Manager

---

### 7. Alerts / CloudWatch

Subscribe your email to the SNS alerts topic (DLQ failures, budget alerts):
```bash
# Get the topic ARN from the ObservabilityStack output, then:
aws sns subscribe \
  --topic-arn <AlertTopicArn-from-cdk-output> \
  --protocol email \
  --notification-endpoint 'you@yourdomain.com'
# Confirm the subscription via the email you receive
```

Update SSM (used by budget alerts):
```bash
aws ssm put-parameter \
  --name /intel-ingester/prod/config/alert-email \
  --value 'you@yourdomain.com' \
  --type String --overwrite
```

- [ ] SNS subscription confirmed (confirmation email sent — click link in inbox)
- [x] alert-email SSM param updated

---

### 8. Build and push Docker worker images

Workers run as ECS Fargate tasks. Build from the `backend/` directory:

```bash
cd backend

# Get your ECR registry URL
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region)
ECR="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

# Authenticate Docker to ECR
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR

# Build and push each worker
for worker in rss reddit youtube podcast pdf manual; do
  # Create ECR repo (first time only)
  aws ecr create-repository --repository-name intel-ingester-${worker}-worker 2>/dev/null || true

  docker build -f workers/${worker}/Dockerfile -t intel-ingester-${worker}-worker .
  docker tag intel-ingester-${worker}-worker:latest $ECR/intel-ingester-${worker}-worker:latest
  docker push $ECR/intel-ingester-${worker}-worker:latest
done
```

Then update `infra/lib/stacks/ingestion-stack.ts` — in the `makeTaskDef` function, replace the placeholder image:
```typescript
// Replace this line:
image: ecs.ContainerImage.fromRegistry('public.ecr.aws/amazonlinux/amazonlinux:2023'),
// With (for each worker type — or use a dynamic lookup):
image: ecs.ContainerImage.fromEcrRepository(
  ecr.Repository.fromRepositoryName(this, `${id}Repo`, `intel-ingester-${workerType}-worker`)
),
```
Then redeploy: `npx cdk deploy IngestionStack`

- [x] ECR repos created (6 repos)
- [x] All 6 worker images built and pushed (via AWS CodeBuild)
- [x] ECS task definition families registered with ECR images (via `aws ecs register-task-definition`)
- [x] Task definitions active and ready

---

### 9. Build and deploy the frontend

```bash
cd frontend
npm install

# Set your API Gateway URL (from ApiStack output)
echo "NEXT_PUBLIC_API_URL=https://<api-id>.execute-api.<region>.amazonaws.com" > .env.local

npm run build
# This generates the static export in out/

# Deploy to S3 (bucket name from FrontendStack output)
aws s3 sync out/ s3://intel-ingester-frontend-<account>-<region>/ --delete

# Invalidate CloudFront cache (distribution ID from FrontendStack output)
aws cloudfront create-invalidation \
  --distribution-id <CloudFront-Distribution-ID> \
  --paths "/*"
```

- [x] .env.local created with NEXT_PUBLIC_API_URL
- [x] `npm run build` succeeds
- [x] Frontend deployed to S3
- [x] CloudFront cache invalidated

---

### 10. Final end-to-end test

1. Open the CloudFront URL → should redirect to `/login`
2. Login with your password (set in step 4)
3. Go to **Settings** → paste your API key (from step 4) → Save
4. Go to **Topics** → create a new topic (e.g. "Mobile gaming martech stack")
5. Go to **Sources** → add an RSS source (e.g. `https://techcrunch.com/feed/`)
6. Back on the topic → click **Run Scan** → check ECS console for running task
7. Wait for scan to complete → click **Synthesise**
8. Wait ~2 mins → check your email for the digest
9. Dashboard should show the digest

- [ ] Login works
- [ ] API key accepted
- [ ] Topic created
- [ ] Source added
- [ ] Scan triggers ECS task
- [ ] Synthesis produces digest
- [ ] Email received

---

## Pre-commit hooks (optional but recommended)

```bash
pip install pre-commit
pre-commit install
```

---

## Notes

- **No LinkedIn ingestion** — no usable public API. Use the "Manual" source type (paste/upload content).
- **Podcast transcription** — Amazon Transcribe charges ~$0.015/min batch. A 45-min episode costs ~$0.68. Costs accrue only when a scan is running.
- **Cost estimate** — ~$8–15/mo baseline; ~$4/scan; ~$25–30/mo at weekly cadence.
- **Model IDs** — stored in SSM at `/intel-ingester/prod/config/bedrock-*-model`. Defaults are Claude Sonnet 4.5 (synthesis), Claude Haiku 4.5 (scoring), Titan Embed v2 (embeddings). Update to override without code changes.
