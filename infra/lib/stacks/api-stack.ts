import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2_integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { StorageStack } from './storage-stack';
import { IngestionStack } from './ingestion-stack';
import { SsmAuthStack } from './ssm-auth-stack';
import { SynthesisStack } from './synthesis-stack';

export interface ApiStackProps extends cdk.StackProps {
  storageStack: StorageStack;
  ingestionStack: IngestionStack;
  ssmAuthStack: SsmAuthStack;
  synthesisStack: SynthesisStack;
}

export class ApiStack extends cdk.Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // IAM — API Lambda role
    const apiLambdaRole = new iam.Role(this, 'ApiLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    props.storageStack.table.grantReadWriteData(apiLambdaRole);
    props.storageStack.rawBucket.grantRead(apiLambdaRole);

    // API Lambda needs to start ECS Fargate tasks (RunTask) for scan triggers
    apiLambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'EcsRunTask',
      actions: ['ecs:RunTask', 'iam:PassRole'],
      resources: [
        props.ingestionStack.cluster.clusterArn,
        props.ingestionStack.rssTaskDef.taskDefinitionArn,
        props.ingestionStack.redditTaskDef.taskDefinitionArn,
        props.ingestionStack.youtubeTaskDef.taskDefinitionArn,
        props.ingestionStack.podcastTaskDef.taskDefinitionArn,
        props.ingestionStack.pdfTaskDef.taskDefinitionArn,
        props.ingestionStack.manualTaskDef.taskDefinitionArn,
        props.ingestionStack.workerTaskRole.roleArn,
      ],
    }));

    // API Lambda needs to start synthesis Step Functions executions
    apiLambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'StepFunctionsStart',
      actions: ['states:StartExecution'],
      resources: [props.synthesisStack.stateMachine.stateMachineArn],
    }));

    apiLambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SsmRead',
      actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/intel-ingester/*`],
    }));

    // API Lambda — FastAPI + Mangum adapter (placeholder; real code in Phase 3)
    const apiLambda = new lambda.Function(this, 'ApiLambda', {
      functionName: 'intel-ingester-api',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      role: apiLambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        ENV: 'prod',
        API_KEY_PARAM: props.ssmAuthStack.apiKeyParamName,
        STATE_MACHINE_ARN: props.synthesisStack.stateMachine.stateMachineArn,
        ECS_CLUSTER: props.ingestionStack.cluster.clusterName,
      },
      code: lambda.Code.fromInline(`
import json

def handler(event, context):
    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({'status': 'ok', 'message': 'Intel Ingester API placeholder — Phase 3'})
    }
`),
    });

    // API Gateway HTTP API — no Cognito authoriser; auth via X-API-Key header in FastAPI
    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'intel-ingester-api',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type', 'X-API-Key'],
      },
    });

    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new apigwv2_integrations.HttpLambdaIntegration('ApiIntegration', apiLambda),
    });

    this.apiUrl = httpApi.url!;

    new cdk.CfnOutput(this, 'ApiUrl', { value: this.apiUrl });
  }
}
