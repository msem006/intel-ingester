#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/stacks/storage-stack';
import { SsmAuthStack } from '../lib/stacks/ssm-auth-stack';
import { SecretsStack } from '../lib/stacks/secrets-stack';
import { IngestionStack } from '../lib/stacks/ingestion-stack';
import { EmailStack } from '../lib/stacks/email-stack';
import { SynthesisStack } from '../lib/stacks/synthesis-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';
import { ObservabilityStack } from '../lib/stacks/observability-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// Dependency order:
//   StorageStack (no deps)
//   SsmAuthStack (no deps)
//   SecretsStack → StorageStack
//   IngestionStack → StorageStack, SecretsStack
//   EmailStack → StorageStack
//   SynthesisStack → StorageStack, IngestionStack, EmailStack
//   ApiStack → StorageStack, IngestionStack, SsmAuthStack, SynthesisStack
//   FrontendStack (no deps)
//   ObservabilityStack → IngestionStack, SynthesisStack

const storageStack = new StorageStack(app, 'StorageStack', { env });

const ssmAuthStack = new SsmAuthStack(app, 'SsmAuthStack', { env });

const secretsStack = new SecretsStack(app, 'SecretsStack', {
  env,
  storageStack,
});

const ingestionStack = new IngestionStack(app, 'IngestionStack', {
  env,
  storageStack,
  secretsStack,
});

const emailStack = new EmailStack(app, 'EmailStack', {
  env,
  storageStack,
});

const synthesisStack = new SynthesisStack(app, 'SynthesisStack', {
  env,
  storageStack,
  ingestionStack,
  emailStack,
});

new ApiStack(app, 'ApiStack', {
  env,
  storageStack,
  ingestionStack,
  ssmAuthStack,
  synthesisStack,
});

new FrontendStack(app, 'FrontendStack', { env });

new ObservabilityStack(app, 'ObservabilityStack', {
  env,
  ingestionStack,
  synthesisStack,
});
