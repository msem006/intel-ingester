import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class SsmAuthStack extends cdk.Stack {
  public readonly passwordParamName: string;
  public readonly apiKeyParamName: string;
  public readonly sessionSecretParamName: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Login password (bcrypt hash) — set real value post-deploy via CLI:
    //   aws ssm put-parameter --name /intel-ingester/prod/auth/password --value '<hash>' --overwrite
    const passwordParam = new ssm.StringParameter(this, 'AuthPassword', {
      parameterName: '/intel-ingester/prod/auth/password',
      stringValue: 'PLACEHOLDER_BCRYPT_HASH_SET_AFTER_DEPLOY',
      description: 'Bcrypt hash of the dashboard login password',
      tier: ssm.ParameterTier.STANDARD,
    });

    // API key for X-API-Key header (dashboard → API Gateway)
    const apiKeyParam = new ssm.StringParameter(this, 'AuthApiKey', {
      parameterName: '/intel-ingester/prod/auth/api-key',
      stringValue: 'PLACEHOLDER_SET_AFTER_DEPLOY',
      description: 'API key validated by FastAPI on every request',
      tier: ssm.ParameterTier.STANDARD,
    });

    // iron-session AES-256 cookie encryption key (32-byte hex string)
    const sessionSecretParam = new ssm.StringParameter(this, 'SessionSecret', {
      parameterName: '/intel-ingester/prod/auth/session-secret',
      stringValue: 'PLACEHOLDER_32_BYTE_HEX_SET_AFTER_DEPLOY',
      description: 'AES-256 secret for iron-session HTTP-only cookie encryption',
      tier: ssm.ParameterTier.STANDARD,
    });

    this.passwordParamName = passwordParam.parameterName;
    this.apiKeyParamName = apiKeyParam.parameterName;
    this.sessionSecretParamName = sessionSecretParam.parameterName;

    new cdk.CfnOutput(this, 'PasswordParamName', { value: this.passwordParamName });
    new cdk.CfnOutput(this, 'ApiKeyParamName', { value: this.apiKeyParamName });
    new cdk.CfnOutput(this, 'SessionSecretParamName', { value: this.sessionSecretParamName });
  }
}
