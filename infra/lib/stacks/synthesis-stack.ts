import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambda_event_sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { StorageStack } from './storage-stack';
import { IngestionStack } from './ingestion-stack';
import { EmailStack } from './email-stack';

export interface SynthesisStackProps extends cdk.StackProps {
  storageStack: StorageStack;
  ingestionStack: IngestionStack;
  emailStack: EmailStack;
}

const PLACEHOLDER_HANDLER = `
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    logger.info(json.dumps(event, default=str))
    return event
`;

export class SynthesisStack extends cdk.Stack {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: SynthesisStackProps) {
    super(scope, id, props);

    // IAM — shared Lambda execution role for all synthesis Lambdas
    const lambdaRole = new iam.Role(this, 'SynthesisLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    props.storageStack.table.grantReadWriteData(lambdaRole);
    props.storageStack.rawBucket.grantReadWrite(lambdaRole);
    props.storageStack.embeddingsBucket.grantReadWrite(lambdaRole);
    props.ingestionStack.toProcessQueue.grantConsumeMessages(lambdaRole);
    props.ingestionStack.toScoreQueue.grantSendMessages(lambdaRole);
    props.ingestionStack.toScoreQueue.grantConsumeMessages(lambdaRole);
    props.emailStack.digestTopic.grantPublish(lambdaRole);

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'BedrockInvoke',
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      // Model IDs stored in SSM — wildcard here covers all models in the account
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/*`],
    }));

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SsmRead',
      actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/intel-ingester/*`],
    }));

    const commonEnv = { ENV: 'prod' };

    // Processor Lambda — SQS-triggered; chunks + embeds raw content via Bedrock Titan Embed.
    // Writes embeddings to S3, updates DynamoDB status EMBEDDED, publishes to to-score queue.
    const processorLambda = new lambda.Function(this, 'ProcessorLambda', {
      functionName: 'intel-ingester-processor',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      role: lambdaRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: commonEnv,
      code: lambda.Code.fromInline(PLACEHOLDER_HANDLER),
    });

    processorLambda.addEventSource(
      new lambda_event_sources.SqsEventSource(props.ingestionStack.toProcessQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(30),
      }),
    );

    // Scorer Lambda — SQS-triggered; calls Bedrock Haiku to score item relevance 0–10.
    // Updates DynamoDB status SCORED.
    const scorerLambda = new lambda.Function(this, 'ScorerLambda', {
      functionName: 'intel-ingester-scorer',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      role: lambdaRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: commonEnv,
      code: lambda.Code.fromInline(PLACEHOLDER_HANDLER),
    });

    scorerLambda.addEventSource(
      new lambda_event_sources.SqsEventSource(props.ingestionStack.toScoreQueue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(30),
      }),
    );

    // Collector Lambda — Step Functions State 1+2 (Collect + Assemble).
    // Queries DynamoDB GSI2 for SCORED items ≥ 6 in window; fetches clean text from S3.
    const collectorLambda = new lambda.Function(this, 'CollectorLambda', {
      functionName: 'intel-ingester-collector',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      role: lambdaRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: commonEnv,
      code: lambda.Code.fromInline(PLACEHOLDER_HANDLER),
    });

    // Synthesiser Lambda — Step Functions State 3+4 (Synthesise + Store).
    // Calls Bedrock Claude Sonnet with assembled context; writes digest to DynamoDB.
    const synthesiserLambda = new lambda.Function(this, 'SynthesiserLambda', {
      functionName: 'intel-ingester-synthesiser',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      role: lambdaRole,
      timeout: cdk.Duration.minutes(10),
      memorySize: 1024,
      environment: commonEnv,
      code: lambda.Code.fromInline(PLACEHOLDER_HANDLER),
    });

    // Step Functions — Standard Workflow (Collect → Assemble → Synthesise → Store → Notify)
    // Standard chosen over Express: synthesis can approach 3-4 min; Express 5-min limit too close.
    // Cost: $0.000125/execution (5 transitions × $0.025/1,000) — cheaper than Express at scale.
    const collectStep = new tasks.LambdaInvoke(this, 'Collect', {
      lambdaFunction: collectorLambda,
      comment: 'Query DynamoDB for SCORED items in window (score ≥ 6)',
      outputPath: '$.Payload',
    });

    const synthesiseStep = new tasks.LambdaInvoke(this, 'Synthesise', {
      lambdaFunction: synthesiserLambda,
      comment: 'Call Bedrock Claude Sonnet; write digest to DynamoDB',
      outputPath: '$.Payload',
    });

    const notifyStep = new tasks.SnsPublish(this, 'Notify', {
      topic: props.emailStack.digestTopic,
      message: sfn.TaskInput.fromJsonPathAt('$'),
      comment: 'Publish digest to SNS → emailer Lambda → SES',
    });

    const definition = collectStep
      .next(synthesiseStep)
      .next(notifyStep);

    this.stateMachine = new sfn.StateMachine(this, 'SynthesisStateMachine', {
      stateMachineName: 'intel-ingester-synthesis',
      stateMachineType: sfn.StateMachineType.STANDARD,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(30),
    });

    // Grant Step Functions permission to invoke synthesis Lambdas
    collectorLambda.grantInvoke(this.stateMachine.role);
    synthesiserLambda.grantInvoke(this.stateMachine.role);

    new cdk.CfnOutput(this, 'StateMachineArn', { value: this.stateMachine.stateMachineArn });
  }
}
