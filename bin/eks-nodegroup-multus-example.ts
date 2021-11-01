#!/usr/bin/env node
import 'source-map-support/register';
import { MyStack } from '../lib/eks-all-in-one';
import { App } from '@aws-cdk/core';



// const app = new cdk.App();
// const account = app.node.tryGetContext('account') || process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT;
// const primaryRegion = {account: account, region: 'us-east-2'};

// const primaryCluster = new EksCluster(app, `MultusNodeGroupStack`, {env: primaryRegion })

const devEnv = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  };
  
const app = new App();

const stackName = app.node.tryGetContext('stackName') || 'cdk-eks-stack';

new MyStack(app, stackName, { env: devEnv });

app.synth();
