import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface StorageStackProps extends cdk.StackProps {}

export class StorageStack extends cdk.Stack {
  public readonly rawBucket: s3.Bucket;
  public readonly embeddingsBucket: s3.Bucket;
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: StorageStackProps) {
    super(scope, id, props);

    // S3 — Raw Content Bucket
    this.rawBucket = new s3.Bucket(this, 'RawBucket', {
      bucketName: `intel-ingester-raw-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'tiering-and-expiry',
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          expiration: cdk.Duration.days(365),
        },
      ],
    });

    // S3 — Embeddings Bucket
    this.embeddingsBucket = new s3.Bucket(this, 'EmbeddingsBucket', {
      bucketName: `intel-ingester-embeddings-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      versioned: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB — Single Table
    this.table = new dynamodb.Table(this, 'IntelIngesterTable', {
      tableName: 'IntelIngester',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI1 — Items by status for a topic (scorer/processor Lambda hot path)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // GSI2 — Items by score >= threshold within date window (collector Lambda)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // GSI3 — Content dedup check (all workers)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: { name: 'GSI3PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI3SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });
  }
}
