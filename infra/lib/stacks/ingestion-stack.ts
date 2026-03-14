import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { StorageStack } from './storage-stack';
import { SecretsStack } from './secrets-stack';

export interface IngestionStackProps extends cdk.StackProps {
  storageStack: StorageStack;
  secretsStack: SecretsStack;
}

export class IngestionStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly toProcessQueue: sqs.Queue;
  public readonly toScoreQueue: sqs.Queue;
  public readonly toProcessDlq: sqs.Queue;
  public readonly toScoreDlq: sqs.Queue;
  public readonly workerTaskRole: iam.Role;
  public readonly rssTaskDef: ecs.FargateTaskDefinition;
  public readonly redditTaskDef: ecs.FargateTaskDefinition;
  public readonly youtubeTaskDef: ecs.FargateTaskDefinition;
  public readonly podcastTaskDef: ecs.FargateTaskDefinition;
  public readonly pdfTaskDef: ecs.FargateTaskDefinition;
  public readonly manualTaskDef: ecs.FargateTaskDefinition;

  constructor(scope: Construct, id: string, props: IngestionStackProps) {
    super(scope, id, props);

    // SQS — to-process queue (worker → processor Lambda)
    this.toProcessDlq = new sqs.Queue(this, 'ToProcessDlq', {
      queueName: 'intel-ingester-to-process-dlq',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.toProcessQueue = new sqs.Queue(this, 'ToProcessQueue', {
      queueName: 'intel-ingester-to-process',
      visibilityTimeout: cdk.Duration.seconds(300),
      retentionPeriod: cdk.Duration.days(7),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: this.toProcessDlq, maxReceiveCount: 3 },
    });

    // SQS — to-score queue (processor Lambda → scorer Lambda)
    this.toScoreDlq = new sqs.Queue(this, 'ToScoreDlq', {
      queueName: 'intel-ingester-to-score-dlq',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.toScoreQueue = new sqs.Queue(this, 'ToScoreQueue', {
      queueName: 'intel-ingester-to-score',
      visibilityTimeout: cdk.Duration.seconds(300),
      retentionPeriod: cdk.Duration.days(7),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: this.toScoreDlq, maxReceiveCount: 3 },
    });

    // SSM — queue URLs consumed by workers and Lambdas at runtime
    new ssm.StringParameter(this, 'ToProcessQueueUrlParam', {
      parameterName: '/intel-ingester/prod/config/to-process-queue-url',
      stringValue: this.toProcessQueue.queueUrl,
      description: 'SQS to-process queue URL',
    });

    new ssm.StringParameter(this, 'ToScoreQueueUrlParam', {
      parameterName: '/intel-ingester/prod/config/to-score-queue-url',
      stringValue: this.toScoreQueue.queueUrl,
      description: 'SQS to-score queue URL',
    });

    // ECS Cluster — Fargate-only, no VPC required at cluster level.
    // Workers specify networking (public subnet + assignPublicIp) at RunTask call time,
    // using the account default VPC. No NAT Gateway needed.
    this.cluster = new ecs.Cluster(this, 'IntelIngesterCluster', {
      clusterName: 'intel-ingester',
      enableFargateCapacityProviders: true,
    });

    // IAM — Fargate execution role (ECR pull + CloudWatch Logs)
    const executionRole = new iam.Role(this, 'FargateExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // IAM — Worker task role (DynamoDB, S3, SQS, Transcribe, Secrets Manager, SSM, Bedrock)
    this.workerTaskRole = new iam.Role(this, 'WorkerTaskRole', {
      roleName: 'intel-ingester-worker-task-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'IAM role for Intel Ingester Fargate ingestion workers',
    });

    props.storageStack.table.grantReadWriteData(this.workerTaskRole);
    props.storageStack.rawBucket.grantReadWrite(this.workerTaskRole);
    props.storageStack.embeddingsBucket.grantReadWrite(this.workerTaskRole);
    this.toProcessQueue.grantSendMessages(this.workerTaskRole);

    this.workerTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'Transcribe',
      actions: [
        'transcribe:StartTranscriptionJob',
        'transcribe:GetTranscriptionJob',
        'transcribe:ListTranscriptionJobs',
      ],
      resources: ['*'],
    }));

    this.workerTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SecretsManagerRead',
      actions: ['secretsmanager:GetSecretValue'],
      resources: [
        props.secretsStack.redditSecretArn,
        props.secretsStack.youtubeSecretArn,
      ],
    }));

    this.workerTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SsmRead',
      actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/intel-ingester/*`],
    }));

    // Fargate task definitions — placeholder containers; replaced with real images in Phase 1/2.
    // Workers are triggered on-demand via RunTask API (zero cost when idle).
    const makeTaskDef = (id: string, workerType: string): ecs.FargateTaskDefinition => {
      const taskDef = new ecs.FargateTaskDefinition(this, id, {
        cpu: 512,
        memoryLimitMiB: 1024,
        taskRole: this.workerTaskRole,
        executionRole,
      });
      taskDef.addContainer(`${workerType}Container`, {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/amazonlinux/amazonlinux:2023'),
        command: ['echo', `intel-ingester ${workerType} worker — placeholder`],
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: `intel-ingester-${workerType}` }),
        environment: { WORKER_TYPE: workerType, ENV: 'prod' },
      });
      return taskDef;
    };

    this.rssTaskDef = makeTaskDef('RssTaskDef', 'rss');
    this.redditTaskDef = makeTaskDef('RedditTaskDef', 'reddit');
    this.youtubeTaskDef = makeTaskDef('YoutubeTaskDef', 'youtube');
    this.podcastTaskDef = makeTaskDef('PodcastTaskDef', 'podcast');
    this.pdfTaskDef = makeTaskDef('PdfTaskDef', 'pdf');
    this.manualTaskDef = makeTaskDef('ManualTaskDef', 'manual');

    new cdk.CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new cdk.CfnOutput(this, 'ToProcessQueueUrl', { value: this.toProcessQueue.queueUrl });
    new cdk.CfnOutput(this, 'ToScoreQueueUrl', { value: this.toScoreQueue.queueUrl });
  }
}
