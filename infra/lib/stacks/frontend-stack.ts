import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export class FrontendStack extends cdk.Stack {
  public readonly distributionUrl: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket — static Next.js export; no public access (CloudFront OAC only)
    this.siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: `intel-ingester-frontend-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront distribution with OAC (Origin Access Control)
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        // SPA fallback: unknown paths → serve index.html (Next.js client-side routing)
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // US + Europe only; cheapest
    });

    this.distributionUrl = `https://${distribution.distributionDomainName}`;

    // Deploy placeholder page — replaced by `next build && next export` output in Phase 3
    new s3deploy.BucketDeployment(this, 'PlaceholderDeploy', {
      sources: [
        s3deploy.Source.data(
          'index.html',
          '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Intel Ingester</title></head><body><h1>Intel Ingester</h1><p>Phase 0 placeholder — frontend ships in Phase 3.</p></body></html>',
        ),
      ],
      destinationBucket: this.siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'DistributionUrl', { value: this.distributionUrl });
    new cdk.CfnOutput(this, 'SiteBucketName', { value: this.siteBucket.bucketName });
  }

  public readonly siteBucket: s3.Bucket;
}
