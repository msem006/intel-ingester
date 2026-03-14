import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambda_event_sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { StorageStack } from './storage-stack';

export interface EmailStackProps extends cdk.StackProps {
  storageStack: StorageStack;
}

export class EmailStack extends cdk.Stack {
  public readonly digestTopic: sns.Topic;
  public readonly sesConfigSetName: string;

  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props);

    // SNS topic — Step Functions Notify step publishes here; emailer Lambda subscribes
    this.digestTopic = new sns.Topic(this, 'DigestTopic', {
      topicName: 'intel-ingester-digest',
      displayName: 'Intel Ingester Digest Notifications',
    });

    // SES configuration set — tracks delivery + bounce/complaint events
    const configSet = new ses.CfnConfigurationSet(this, 'SesConfigSet', {
      name: 'intel-ingester',
    });
    this.sesConfigSetName = 'intel-ingester';

    // Note: SES sending identity (email address or domain) must be verified manually
    // post-deploy via the SES console. SES starts in sandbox mode — submit production
    // access request to send to unverified addresses.

    // SES email addresses — update post-deploy via AWS Console or CLI
    new ssm.StringParameter(this, 'SesFromEmailParam', {
      parameterName: '/intel-ingester/prod/config/ses-from-email',
      stringValue: 'noreply@example.com',
      description: 'SES sending address (verify this address in SES before use)',
    });

    new ssm.StringParameter(this, 'SesToEmailParam', {
      parameterName: '/intel-ingester/prod/config/ses-to-email',
      stringValue: 'user@example.com',
      description: 'Digest recipient email address',
    });

    // IAM — emailer Lambda role
    const emailerRole = new iam.Role(this, 'EmailerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    props.storageStack.table.grantReadData(emailerRole);

    emailerRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SesSend',
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    emailerRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SsmRead',
      actions: ['ssm:GetParameter', 'ssm:GetParameters'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/intel-ingester/*`],
    }));

    // Emailer Lambda — SNS-triggered; renders Jinja2 HTML digest and sends via SES.
    // Placeholder inline handler replaced with real code in Phase 1.
    const emailerLambda = new lambda.Function(this, 'EmailerLambda', {
      functionName: 'intel-ingester-emailer',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      role: emailerRole,
      timeout: cdk.Duration.seconds(60),
      environment: {
        ENV: 'prod',
        SES_CONFIG_SET: this.sesConfigSetName,
      },
      code: lambda.Code.fromInline(`
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    logger.info(json.dumps(event, default=str))
    logger.info('Emailer placeholder — real implementation in Phase 1')
    return {'statusCode': 200}
`),
    });

    emailerLambda.addEventSource(
      new lambda_event_sources.SnsEventSource(this.digestTopic),
    );

    new cdk.CfnOutput(this, 'DigestTopicArn', { value: this.digestTopic.topicArn });
    new cdk.CfnOutput(this, 'SesConfigSetName', { value: this.sesConfigSetName });
  }
}
