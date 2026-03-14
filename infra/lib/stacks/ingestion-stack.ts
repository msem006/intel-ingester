import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class IngestionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
  }
}
