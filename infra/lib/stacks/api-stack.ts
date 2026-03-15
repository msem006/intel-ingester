import * as path from 'path';
import { execSync } from 'child_process';
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

    // API Lambda — FastAPI + Mangum adapter
    const apiLambda = new lambda.Function(this, 'ApiLambda', {
      functionName: 'intel-ingester-api',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'app.main.handler',
      role: apiLambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        ENV: 'prod',
        API_KEY_PARAM: props.ssmAuthStack.apiKeyParamName,
        STATE_MACHINE_ARN: props.synthesisStack.stateMachine.stateMachineArn,
        ECS_CLUSTER: props.ingestionStack.cluster.clusterName,
      },
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../backend'), {
        bundling: {
          local: {
            tryBundle(outputDir: string): boolean {
              try {
                const backendDir = path.join(__dirname, '../../../backend');
                // Install Linux x86_64 wheels so the package runs on Lambda (not macOS wheels)
                execSync(
                  `pip3 install fastapi mangum boto3 pydantic python-ulid itsdangerous bcrypt`
                  + ` tiktoken trafilatura beautifulsoup4`
                  + ` --platform manylinux2014_x86_64`
                  + ` --implementation cp --python-version 312`
                  + ` --only-binary=:all:`
                  + ` -t "${outputDir}" --quiet`,
                  { stdio: ['ignore', 'pipe', 'pipe'] },
                );
                execSync(`cp -r "${backendDir}/api/app" "${outputDir}/app"`);
                execSync(`cp -r "${backendDir}/shared/intel_shared" "${outputDir}/intel_shared"`);
                return true;
              } catch {
                return false;
              }
            },
          },
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c', [
              'pip install fastapi mangum boto3 pydantic python-ulid itsdangerous bcrypt'
                + ' tiktoken trafilatura beautifulsoup4 -t /asset-output --quiet',
              'cp -r api/app /asset-output/app',
              'cp -r shared/intel_shared /asset-output/intel_shared',
            ].join(' && '),
          ],
        },
      }),
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
