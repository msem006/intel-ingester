import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { IngestionStack } from './ingestion-stack';
import { SynthesisStack } from './synthesis-stack';

export interface ObservabilityStackProps extends cdk.StackProps {
  ingestionStack: IngestionStack;
  synthesisStack: SynthesisStack;
}

export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    // SNS alerting topic — all alarms notify this topic
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'intel-ingester-alerts',
      displayName: 'Intel Ingester Alerts',
    });

    // SSM param for alert email (user fills in post-deploy, then subscribes manually)
    new ssm.StringParameter(this, 'AlertEmailParam', {
      parameterName: '/intel-ingester/prod/config/alert-email',
      stringValue: 'alerts@example.com',
      description: 'Email address for CloudWatch alarm notifications',
    });

    // DLQ alarms — alert when messages land in DLQs (indicates processing failures)
    const toProcessDlqAlarm = new cloudwatch.Alarm(this, 'ToProcessDlqAlarm', {
      alarmName: 'intel-ingester-to-process-dlq',
      alarmDescription: 'Messages in to-process DLQ — processor Lambda failures',
      metric: props.ingestionStack.toProcessDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    toProcessDlqAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alertTopic));

    const toScoreDlqAlarm = new cloudwatch.Alarm(this, 'ToScoreDlqAlarm', {
      alarmName: 'intel-ingester-to-score-dlq',
      alarmDescription: 'Messages in to-score DLQ — scorer Lambda failures',
      metric: props.ingestionStack.toScoreDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    toScoreDlqAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alertTopic));

    // CloudWatch Dashboard
    new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: 'IntelIngester',
      widgets: [
        [
          new cloudwatch.TextWidget({
            markdown: '## Intel Ingester — Pipeline Health',
            width: 24,
            height: 1,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'SQS Queue Depths',
            width: 12,
            left: [
              props.ingestionStack.toProcessQueue.metricApproximateNumberOfMessagesVisible(),
              props.ingestionStack.toScoreQueue.metricApproximateNumberOfMessagesVisible(),
            ],
          }),
          new cloudwatch.GraphWidget({
            title: 'DLQ Message Counts',
            width: 12,
            left: [
              props.ingestionStack.toProcessDlq.metricApproximateNumberOfMessagesVisible({ label: 'to-process DLQ' }),
              props.ingestionStack.toScoreDlq.metricApproximateNumberOfMessagesVisible({ label: 'to-score DLQ' }),
            ],
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'Step Functions Executions',
            width: 12,
            left: [
              props.synthesisStack.stateMachine.metricStarted(),
              props.synthesisStack.stateMachine.metricSucceeded(),
              props.synthesisStack.stateMachine.metricFailed(),
            ],
          }),
          new cloudwatch.AlarmStatusWidget({
            title: 'Alarm Status',
            width: 12,
            alarms: [toProcessDlqAlarm, toScoreDlqAlarm],
          }),
        ],
      ],
    });

    // AWS Budgets — monthly $50 limit with 80% actual and 100% forecasted alerts
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'intel-ingester-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: 50, unit: 'USD' },
        costFilters: {
          TagKeyValue: ['user:Project$intel-ingester'],
        },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            { subscriptionType: 'SNS', address: alertTopic.topicArn },
          ],
        },
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            { subscriptionType: 'SNS', address: alertTopic.topicArn },
          ],
        },
      ],
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', { value: alertTopic.topicArn });
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home#dashboards:name=IntelIngester`,
    });
  }
}
