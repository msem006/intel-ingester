#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/stacks/storage-stack';
import { SsmAuthStack } from '../lib/stacks/ssm-auth-stack';
import { SecretsStack } from '../lib/stacks/secrets-stack';
import { IngestionStack } from '../lib/stacks/ingestion-stack';
import { SynthesisStack } from '../lib/stacks/synthesis-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { EmailStack } from '../lib/stacks/email-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

new StorageStack(app, 'StorageStack', { env });
new SsmAuthStack(app, 'SsmAuthStack', { env });
new SecretsStack(app, 'SecretsStack', { env });
new IngestionStack(app, 'IngestionStack', { env });
new SynthesisStack(app, 'SynthesisStack', { env });
new ApiStack(app, 'ApiStack', { env });
new EmailStack(app, 'EmailStack', { env });
new FrontendStack(app, 'FrontendStack', { env });
