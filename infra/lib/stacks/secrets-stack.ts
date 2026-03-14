import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { StorageStack } from './storage-stack';

export interface SecretsStackProps extends cdk.StackProps {
  storageStack: StorageStack;
}

export class SecretsStack extends cdk.Stack {
  public readonly redditSecretArn: string;
  public readonly youtubeSecretArn: string;

  constructor(scope: Construct, id: string, props: SecretsStackProps) {
    super(scope, id, props);

    // Reddit API credentials — set real values in Secrets Manager post-deploy:
    //   { "client_id": "...", "client_secret": "...", "user_agent": "intel-ingester/1.0" }
    const redditSecret = new secretsmanager.Secret(this, 'RedditSecret', {
      secretName: '/intel-ingester/prod/reddit',
      description: 'Reddit API credentials for PRAW worker',
      secretObjectValue: {
        client_id: cdk.SecretValue.unsafePlainText('PLACEHOLDER'),
        client_secret: cdk.SecretValue.unsafePlainText('PLACEHOLDER'),
        user_agent: cdk.SecretValue.unsafePlainText('intel-ingester/1.0'),
      },
    });

    // YouTube Data API v3 key — set real value post-deploy
    const youtubeSecret = new secretsmanager.Secret(this, 'YoutubeSecret', {
      secretName: '/intel-ingester/prod/youtube',
      description: 'YouTube Data API v3 key for YouTube worker',
      secretObjectValue: {
        api_key: cdk.SecretValue.unsafePlainText('PLACEHOLDER'),
      },
    });

    this.redditSecretArn = redditSecret.secretArn;
    this.youtubeSecretArn = youtubeSecret.secretArn;

    // SSM baseline config params — read by Lambda and Fargate at runtime
    new ssm.StringParameter(this, 'TableNameParam', {
      parameterName: '/intel-ingester/prod/config/table-name',
      stringValue: props.storageStack.table.tableName,
      description: 'DynamoDB IntelIngester table name',
    });

    new ssm.StringParameter(this, 'RawBucketParam', {
      parameterName: '/intel-ingester/prod/config/raw-bucket',
      stringValue: props.storageStack.rawBucket.bucketName,
      description: 'S3 raw content bucket name',
    });

    new ssm.StringParameter(this, 'EmbeddingsBucketParam', {
      parameterName: '/intel-ingester/prod/config/embeddings-bucket',
      stringValue: props.storageStack.embeddingsBucket.bucketName,
      description: 'S3 embeddings bucket name',
    });

    new cdk.CfnOutput(this, 'RedditSecretArn', { value: this.redditSecretArn });
    new cdk.CfnOutput(this, 'YoutubeSecretArn', { value: this.youtubeSecretArn });
  }
}
