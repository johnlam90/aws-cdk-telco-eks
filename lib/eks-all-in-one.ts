import * as eks from '@aws-cdk/aws-eks';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as lambda from '@aws-cdk/aws-lambda';
import * as iam from '@aws-cdk/aws-iam';
import * as targets from '@aws-cdk/aws-events-targets';
import * as events from '@aws-cdk/aws-events';
import * as custom from '@aws-cdk/custom-resources';
import * as cdk from '@aws-cdk/core';
import console = require('console');
import {CfnJson,Construct,Duration} from '@aws-cdk/core';
import {Subnet,SubnetType} from '@aws-cdk/aws-ec2';
import {ManagedPolicy} from '@aws-cdk/aws-iam';
import * as efs from "@aws-cdk/aws-efs";
import {App,Stack,StackProps} from '@aws-cdk/core';


export interface EksClusterProps {
  readonly vpc ? : ec2.IVpc;

}

export class EksCluster extends Construct {
  constructor(scope: Construct, id: string, props: EksClusterProps) {
    super(scope, id, );


    const vpc = props.vpc ?? new ec2.Vpc(this, 'Vpc', {
      cidr: '172.16.0.0/16',
      natGateways: 1,
      subnetConfiguration: [{
          name: 'private-subnet-1',
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
          cidrMask: 19,
        },

      {
          name: 'public-subnet-1',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 19,
       }, 

      ],
    });
    const tagAllSubnets = (
      subnets: ec2.ISubnet[],
      tagName: string,
      tagValue: string,
    ) => {
      for (const subnet of subnets) {
        cdk.Tags.of(subnet).add(
          tagName,
          `${tagValue}-${subnet.availabilityZone}`,
        );
      }
    };
    // 👇 tag subnets
    const {stackName} = cdk.Stack.of(this);
    tagAllSubnets(vpc.publicSubnets, 'Name', `${stackName}/public`);
    tagAllSubnets(vpc.privateSubnets, 'Name', `${stackName}/private`);


    // Create Private and Public Subnets    
    //todo fix this when using context variables
    const k8sSubnetA = vpc.selectSubnets({
      subnetType: SubnetType.PRIVATE_WITH_NAT,
      availabilityZones: [this.node.tryGetContext('private.subnetA')],
    });
    const k8sSubnetB = vpc.selectSubnets({
      subnetType: SubnetType.PRIVATE_WITH_NAT,
      availabilityZones: [this.node.tryGetContext('private.subnetB')],
    });
    const k8sSubnetC = vpc.selectSubnets({
      subnetType: SubnetType.PRIVATE_WITH_NAT,
      availabilityZones: [this.node.tryGetContext('private.subnetC')],
    });
    const k8sSubnet1 = k8sSubnetA.subnetIds.toString();
    const subnetA = Subnet.fromSubnetId(this, 'SubnetFromIdA', k8sSubnet1);
    const k8sSubnet2 = k8sSubnetB.subnetIds.toString();
    const subnetB = Subnet.fromSubnetId(this, 'SubnetFromIdB', k8sSubnet2);
    const k8sSubnet3 = k8sSubnetC.subnetIds.toString();
    const subnetC = Subnet.fromSubnetId(this, 'SubnetFromIdC', k8sSubnet3);

    const onlyVpc = this.node.tryGetContext("only_vpc") == '1' ? true : false;
    //  This is the root if/else condition which decides whether to create the EKS cluster and NodeGroups  or not "cdk deploy -c only_vpc=1"
    if (onlyVpc) {
      console.log('only vpc is selected,skipping rest of the deployment');
    } else {
      // Create EKS Cluster along with OIDC Provider, Roles and Policies, helm charts
      // Eks Cluster admin role
      const clusterAdmin = new iam.Role(this, 'AdminRole', {
        assumedBy: new iam.AccountRootPrincipal()
      });
      

      //  * EKS Cluster creation
      const cluster = new eks.Cluster(this, 'Cluster', {
        clusterName: this.node.tryGetContext("eks.clustername"),
        outputClusterName: true,
        mastersRole: clusterAdmin,
        outputMastersRoleArn: true,
        vpc: vpc,
        defaultCapacity: 1,
        vpcSubnets: [{
          subnets: [
            ec2.Subnet.fromSubnetId(this, 'us-az-a', k8sSubnet1),
            ec2.Subnet.fromSubnetId(this, 'us-az-b', k8sSubnet2),
            ec2.Subnet.fromSubnetId(this, 'us-az-c', k8sSubnet3),
            //ec2.Subnet.fromSubnetId(this,'us-az-a', this.node.tryGetContext("eks.privateSubnetAId")),
            //ec2.Subnet.fromSubnetId(this,'us-az-b', this.node.tryGetContext("eks.privateSubnetBId")),
            //ec2.Subnet.fromSubnetId(this,'us-az-c', this.node.tryGetContext("eks.privateSubnetCId")),
          ]
        }],
        version: eks.KubernetesVersion.V1_21,
      });
      // Adding my username to masters role 
      cluster.awsAuth.addUserMapping(iam.User.fromUserName(this, 'johnlam90', 'johnlam90'), {
        groups: ["system:masters"],
        username: "johnlam90"
      });

      // Use existing EKS Cluster
      const eksCluster = eks.Cluster.fromClusterAttributes(this, "eks-cluster", {
        clusterName: cluster.clusterName,
        vpc: vpc,
      });

      const clusterOpenIdConnectIssuerUrl = cluster.clusterOpenIdConnectIssuerUrl

      // then we create an OpenID connect provider using the issue url value we stored earlier 
      const provider = new eks.OpenIdConnectProvider(this, 'Provider', {
        url: clusterOpenIdConnectIssuerUrl
      });

      // now we attach the new OIDC provider to our EKS cluster  
      eks.Cluster.fromClusterAttributes(this, `${this.node.tryGetContext("eks.clustername")}-oidc-provider`, {
        clusterName: this.node.tryGetContext("eks.clustername"),
        openIdConnectProvider: provider,
      });
      cluster.addHelmChart(`flux`, {
        repository: 'https://charts.fluxcd.io',
        chart: 'flux',
        release: 'flux',
        values: {
          'git.url': 'git@github.com:org/repo'
        }
      });
      cluster.addHelmChart(`multus`, {
        repository: 'https://johnlam90.github.io/helm-chart',
        chart: 'addons',
        release: 'addons'
      });
      cluster.addHelmChart(`whereabouts`, {
        repository: 'https://johnlam90.github.io/helm-chart',
        chart: 'whereabouts',
        release: 'whereabouts'
      });
      const policyDocument = {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": [
              "elasticfilesystem:DescribeAccessPoints",
              "elasticfilesystem:DescribeFileSystems"
            ],
            "Resource": "*"
          },
          {
            "Effect": "Allow",
            "Action": [
              "elasticfilesystem:CreateAccessPoint"
            ],
            "Resource": "*",
            "Condition": {
              "StringLike": {
                "aws:RequestTag/efs.csi.aws.com/cluster": "true"
              }
            }
          },
          {
            "Effect": "Allow",
            "Action": "elasticfilesystem:DeleteAccessPoint",
            "Resource": "*",
            "Condition": {
              "StringEquals": {
                "aws:ResourceTag/efs.csi.aws.com/cluster": "true"
              }
            }
          }
        ]
      };
      const customPolicyDocument = iam.PolicyDocument.fromJson(policyDocument);
      const newManagedPolicy = new iam.ManagedPolicy(this, `MyNewEfsManagedPolicy-${this.node.tryGetContext("eks.clustername")}`, {
        managedPolicyName: `myEfsCdkManagedPolicy-${this.node.tryGetContext("eks.clustername")}`,
        document: customPolicyDocument
      });
      const openIdConnectProvider = provider.openIdConnectProviderIssuer;
      const account = cluster.role.env.account;

      // Conditions for EFS Access
      const conditions = new CfnJson(this, 'ConditionJson', {
        value: {
          [`${openIdConnectProvider}:sub`]: `system:serviceaccount:kube-system:efs-csi-controller-sa`,
        },
      });

      // Condiditon for EBS Access
      const conditions2 = new CfnJson(this, 'ConditionJson2', {
        value: {
          [`${openIdConnectProvider}:sub`]: `system:serviceaccount:kube-system:ebs-csi-controller-sa`,
        },
      });

      const role = new iam.Role(this, `${this.node.tryGetContext("eks.clustername")}-fs-iam-role`, {
        roleName: `AmazonEKS_EFS_CSI_DriverRole_CDK-${this.node.tryGetContext("eks.clustername")}`,
        assumedBy: new iam.FederatedPrincipal(`arn:aws:iam::${account}:oidc-provider/${openIdConnectProvider}`, {
            'StringEquals': conditions
          },
          "sts:AssumeRoleWithWebIdentity")
      });

      role.addManagedPolicy(
        iam.ManagedPolicy.fromManagedPolicyName(this, `${this.node.tryGetContext("eks.clustername")}-fs-managed-policy`,
          newManagedPolicy.managedPolicyName,
        ),
      );

      const policyDocument2 = {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": [
              "ec2:CreateSnapshot",
              "ec2:AttachVolume",
              "ec2:DetachVolume",
              "ec2:ModifyVolume",
              "ec2:DescribeAvailabilityZones",
              "ec2:DescribeInstances",
              "ec2:DescribeSnapshots",
              "ec2:DescribeTags",
              "ec2:DescribeVolumes",
              "ec2:DescribeVolumesModifications"
            ],
            "Resource": "*"
          },
          {
            "Effect": "Allow",
            "Action": [
              "ec2:CreateTags"
            ],
            "Resource": [
              "arn:aws:ec2:*:*:volume/*",
              "arn:aws:ec2:*:*:snapshot/*"
            ],
            "Condition": {
              "StringEquals": {
                "ec2:CreateAction": [
                  "CreateVolume",
                  "CreateSnapshot"
                ]
              }
            }
          },
          {
            "Effect": "Allow",
            "Action": [
              "ec2:DeleteTags"
            ],
            "Resource": [
              "arn:aws:ec2:*:*:volume/*",
              "arn:aws:ec2:*:*:snapshot/*"
            ]
          },
          {
            "Effect": "Allow",
            "Action": [
              "ec2:CreateVolume"
            ],
            "Resource": "*",
            "Condition": {
              "StringLike": {
                "aws:RequestTag/ebs.csi.aws.com/cluster": "true"
              }
            }
          },
          {
            "Effect": "Allow",
            "Action": [
              "ec2:CreateVolume"
            ],
            "Resource": "*",
            "Condition": {
              "StringLike": {
                "aws:RequestTag/CSIVolumeName": "*"
              }
            }
          },
          {
            "Effect": "Allow",
            "Action": [
              "ec2:CreateVolume"
            ],
            "Resource": "*",
            "Condition": {
              "StringLike": {
                "aws:RequestTag/kubernetes.io/cluster/*": "owned"
              }
            }
          },
          {
            "Effect": "Allow",
            "Action": [
              "ec2:DeleteVolume"
            ],
            "Resource": "*",
            "Condition": {
              "StringLike": {
                "ec2:ResourceTag/ebs.csi.aws.com/cluster": "true"
              }
            }
          },
          {
            "Effect": "Allow",
            "Action": [
              "ec2:DeleteVolume"
            ],
            "Resource": "*",
            "Condition": {
              "StringLike": {
                "ec2:ResourceTag/CSIVolumeName": "*"
              }
            }
          },
          {
            "Effect": "Allow",
            "Action": [
              "ec2:DeleteVolume"
            ],
            "Resource": "*",
            "Condition": {
              "StringLike": {
                "ec2:ResourceTag/kubernetes.io/cluster/*": "owned"
              }
            }
          },
          {
            "Effect": "Allow",
            "Action": [
              "ec2:DeleteSnapshot"
            ],
            "Resource": "*",
            "Condition": {
              "StringLike": {
                "ec2:ResourceTag/CSIVolumeSnapshotName": "*"
              }
            }
          },
          {
            "Effect": "Allow",
            "Action": [
              "ec2:DeleteSnapshot"
            ],
            "Resource": "*",
            "Condition": {
              "StringLike": {
                "ec2:ResourceTag/ebs.csi.aws.com/cluster": "true"
              }
            }
          }
        ]
      }
      const customPolicyDocument2 = iam.PolicyDocument.fromJson(policyDocument2);

      const newManagedPolicy2 = new iam.ManagedPolicy(this, `MyNewEbsManagedPolicy-${this.node.tryGetContext("eks.clustername")}`, {
        managedPolicyName: `myEbsCdkManagedPolicy-${this.node.tryGetContext("eks.clustername")}`,
        document: customPolicyDocument2
      });
      const role2 = new iam.Role(this, `${this.node.tryGetContext("eks.clustername")}-ebs-iam-role`, {
        roleName: `AmazonEKS_EBS_CSI_DriverRole-${this.node.tryGetContext("eks.clustername")}`,
        assumedBy: new iam.FederatedPrincipal(`arn:aws:iam::${account}:oidc-provider/${openIdConnectProvider}`, {
            'StringEquals': conditions2
          },
          "sts:AssumeRoleWithWebIdentity")
      });

      role2.addManagedPolicy(
        iam.ManagedPolicy.fromManagedPolicyName(this, `${this.node.tryGetContext("eks.clustername")}-ebs-managed-policy`,
        newManagedPolicy2.managedPolicyName,
        ),
      );

      cluster.addHelmChart(`aws-ebs-csi-driver`, {
        repository: 'https://johnlam90.github.io/helm-chart',
        chart: 'aws-ebs-csi-driver',
        release: 'aws-ebs-csi-driver',
        namespace: 'kube-system',
        values: {
          'image.repository': `602401143452.dkr.ecr.${this.node.tryGetContext("nodegroup.region")}.amazonaws.com/eks/aws-ebs-csi-driver`,
          'account': account,
          'role': role2.roleName
        }
      });


      // This nested if/else condtion is to check whether the nodegroup should be created or not.
      const noNg = this.node.tryGetContext("no_ng") == '1' ? true : false;
      if (noNg) {
        console.log('no_ng is set to true, skipping NG');
      } else {
        const noFs = this.node.tryGetContext('no_fs') == '1' ? true : false;
        if (noFs) {
          console.log('disable_fs is set to true, skipping ');
        } else {
          const NgSG = new ec2.SecurityGroup(this, `${this.node.tryGetContext("cnf")}-fs-sg`, {
            vpc: vpc,
            allowAllOutbound: true,
            description: 'security group for a web server',
          });

          NgSG.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.allTraffic(),
          );

          const fileSystem = new efs.FileSystem(this, 'MyEfsFileSystem', {
            vpc: vpc,
            fileSystemName: `eks-efs-${this.node.tryGetContext("cnf")}-fs`,
            vpcSubnets: {
              onePerAz: false,
              subnets: [
                subnetA,
                subnetB,
                subnetC,
              ]
            },
            throughputMode: efs.ThroughputMode.BURSTING,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            //provisionedThroughputPerSecond: cdk.Size.mebibytes(512),
            lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS, // files are not transitioned to infrequent access (IA) storage by default
            performanceMode: efs.PerformanceMode.GENERAL_PURPOSE, // default
            securityGroup: NgSG,
          });

          cluster.addHelmChart(`aws-efs-csi-driver`, {
            repository: 'https://johnlam90.github.io/helm-chart',
            chart: 'aws-efs-csi-driver',
            release: 'aws-efs-csi-driver',
            namespace: 'kube-system',
            values: {
              'image.repository': `602401143452.dkr.ecr.${this.node.tryGetContext("nodegroup.region")}.amazonaws.com/eks/aws-efs-csi-driver`,
              'account': account,
              'role': role.roleName
            }
          });
          cluster.addHelmChart(`efs-sc`, {
            repository: 'https://johnlam90.github.io/helm-chart',
            chart: 'efs-sc',
            release: 'efs-sc',
            //namespace: 'kube-system',
            values: {
              'cnf': this.node.tryGetContext("cnf"),
              'fsid': fileSystem.fileSystemId,
            }
          });
        }
        //* Create Multus Subnets for the NodeGroup
        const subnet1 = new ec2.Subnet(this, `${this.node.tryGetContext("cnf")}-multus-01`, {
          availabilityZone: this.node.tryGetContext("multus.az"),
          cidrBlock: '172.16.231.0/24',
          vpcId: vpc.vpcId,
        });
        const subnet2 = new ec2.Subnet(this, `${this.node.tryGetContext("cnf")}-multus-02`, {
          availabilityZone: this.node.tryGetContext("multus.az"),
          cidrBlock: '172.16.232.0/24',
          vpcId: vpc.vpcId,
        });
        const subnet3 = new ec2.Subnet(this, `${this.node.tryGetContext("cnf")}-multus-03`, {
          availabilityZone: this.node.tryGetContext("multus.az"),
          cidrBlock: '172.16.233.0/24',
          vpcId: vpc.vpcId,
        });
        const subnet4 =  new ec2.Subnet(this, `${this.node.tryGetContext("cnf")}-multus-04`, {
            availabilityZone: this.node.tryGetContext("multus.az"),
            cidrBlock: '172.16.234.0/24',
            vpcId: vpc.vpcId,
        });
        // const subnet5 =  new ec2.Subnet(this, `${this.node.tryGetContext("cnf")}-multus-05`, {
        //     availabilityZone: this.node.tryGetContext("multus.az"),
        //     cidrBlock: '172.16.235.0/24',
        //     vpcId: vpc.vpcId,
        // });
        // const subnet6 =  new ec2.Subnet(this, `${this.node.tryGetContext("cnf")}-multus-06`, {
        //     availabilityZone: this.node.tryGetContext("multus.az"),
        //     cidrBlock: '172.16.236.0/24',
        //     vpcId: vpc.vpcId,
        // });
        // const subnet7 =  new ec2.Subnet(this, `${this.node.tryGetContext("cnf")}-multus-07`, {
        //     availabilityZone: this.node.tryGetContext("multus.az"),
        //     cidrBlock: '172.16.237.0/24',
        //     vpcId: vpc.vpcId,
        // });
        // const subnet8 =  new ec2.Subnet(this, `${this.node.tryGetContext("cnf")}-multus-08`, {
        //     availabilityZone: this.node.tryGetContext("multus.az"),
        //     cidrBlock: '172.16.238.0/24',
        //     vpcId: vpc.vpcId,
        // });
        //* Create Security Group for the Multus Subnets
        const NgSG2 = new ec2.SecurityGroup(this, `multus-${this.node.tryGetContext("cnf")}-sg`, {
          vpc: vpc,
          allowAllOutbound: true,
          description: 'security group for a web server',
        });

        NgSG2.addIngressRule(
          ec2.Peer.anyIpv4(),
          ec2.Port.allTraffic(),
        );

        // Create a customized Launch Template for the NodeGroup
        const launchTemplate = new ec2.CfnLaunchTemplate(this, 'LaunchTemplate', {
          launchTemplateData: {
            instanceType: this.node.tryGetContext("nodegroup.instance"),
            keyName: this.node.tryGetContext("nodegroup.sshkey"),
            blockDeviceMappings: [{
              deviceName: "/dev/xvda",
              ebs: {
                volumeSize: this.node.tryGetContext("nodegroup.disk"),
              },
            }],

            userData: cdk.Fn.base64(
              `MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="==MYBOUNDARY=="

--==MYBOUNDARY==
Content-Type: text/x-shellscript; charset="us-ascii"

#!/bin/bash
ls /sys/class/net/ > /tmp/ethList;cat /tmp/ethList |while read line ; do sudo ifconfig $line up; done
grep eth /tmp/ethList |while read line ; do echo "ifconfig $line up" >> /etc/rc.d/rc.local; done
systemctl enable rc-local
yum install -y https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm
systemctl enable amazon-ssm-agent --now

--==MYBOUNDARY==--`),
          },
          launchTemplateName: "multus-launch-template"
        });

        // Formatting required to pass subnet values to lambda function
        const subs = subnet1.subnetId + "," + subnet2.subnetId + "," + subnet3.subnetId + "," + subnet4.subnetId ;
        //const subnetIds = subs.split(",");

        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        );


        //const k8sSubnet = ec2.Subnet.fromSubnetId(this, "k8s-subnet",this.node.tryGetContext("eks.k8ssubnetid"));
        // Create a NodeGroup 
        const ng = new eks.Nodegroup(this, "node-group", {
          cluster: eksCluster,
          minSize: this.node.tryGetContext("nodegroup.min"),
          desiredSize: this.node.tryGetContext("nodegroup.desired"),
          nodegroupName: this.node.tryGetContext("eks.nodegroupname"),
          maxSize: this.node.tryGetContext("nodegroup.max"),
          tags: {
            Name: `${this.node.tryGetContext("cnf")}-ng`
          },
          labels: {
            cnf: `${this.node.tryGetContext("cnf")}`,
          },
          launchTemplateSpec: {
            id: launchTemplate.ref
          },
          subnets: {
            onePerAz: true,
            subnets: [subnetA]
          }

        });
        cdk.Tags.of(ng).add('Name', `${this.node.tryGetContext("cnf")}-ng-01`);

        ng.node.addDependency(launchTemplate);
        // Add SSM access to Worker Nodes
        ng.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'))
        ng.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMFullAccess'))
        ng.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2RoleforSSM'))


        // 👇 add a managed policy to a group after creation

        // Create Lambda for attaching 2nd ENI
        const attachEniPolicyStatement = new iam.PolicyStatement();
        attachEniPolicyStatement.addActions("ec2:CreateNetworkInterface",
          "ec2:DescribeInstances",
          "ec2:ModifyNetworkInterfaceAttribute",
          "ec2:ModifyNetworkInterfaceAttribute",
          "ec2:ModifyInstanceAttribute",
          "autoscaling:CompleteLifecycleAction",
          "ec2:UnassignPrivateIpAddresses",
          "ec2:UnassignIpv6Addresses",
          "ec2:AssignPrivateIpAddresses",
          "ec2:AssignIpv6Addresses",
          "ec2:DeleteTags",
          "ec2:DescribeSubnets",
          "ec2:DescribeNetworkInterfaces",
          "ec2:CreateTags",
          "ec2:DeleteNetworkInterface",
          "ec2:AttachNetworkInterface",
          "autoscaling:DescribeAutoScalingGroups",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:CreateLogGroup",
          "ec2:TerminateInstances",
          "ec2:DetachNetworkInterface");
        attachEniPolicyStatement.addResources("*");
        attachEniPolicyStatement.addActions("logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:CreateLogGroup");
        attachEniPolicyStatement.addResources("arn:aws:logs:*:*:*");

        const lambdaAttachMultusEni = new lambda.Function(this, "LambdaAttachMultusEni", {
          runtime: lambda.Runtime.PYTHON_3_8,
          code: lambda.Code.fromAsset('lambda'),
          handler: 'attach-multus-eni.lambda_handler',
          timeout: Duration.seconds(90),
          environment: {
            // SubnetIds: 'subnet-052648d93b4e9e01e,subnet-0936dd49f7d550214,subnet-09da72e276358044b',
            SubnetIds: subs,
            SecGroupIds: NgSG2.securityGroupId,
            SourceDestCheckEnable: 'false'
          }
        });
        lambdaAttachMultusEni.addToRolePolicy(attachEniPolicyStatement);

        // Find the asgName for CWE
        const customApiCallPolicyStatement = new iam.PolicyStatement();
        customApiCallPolicyStatement.addActions("eks:describeNodegroup");
        customApiCallPolicyStatement.addResources("*")

        const nodegroupNameStrings = cdk.Fn.split("/", ng.nodegroupName);
        const ngName = cdk.Fn.select(1, nodegroupNameStrings);
        const customApiCall = new custom.AwsCustomResource(this, "FindAutoScalingGroup", {
          policy: {
            statements: [customApiCallPolicyStatement],
            resources: ["*"]
          },
          onCreate: {
            service: "EKS",
            action: "describeNodegroup",
            parameters: {
              clusterName: eksCluster.clusterName,
              nodegroupName: ngName
            },
            physicalResourceId: {
              id: "customResourceForApiCall"
            }
          }
        });


        const asgName = customApiCall.getResponseField('nodegroup.resources.autoScalingGroups.0.name');
        // Create Cloudwatch Event
        const eventRule = new events.Rule(this, "cw-event-rule", {
          eventPattern: {
            source: ["aws.autoscaling"],
            detailType: ["EC2 Instance-launch Lifecycle Action", "EC2 Instance-terminate Lifecycle Action"],
            detail: {
              AutoScalingGroupName: [asgName],

            }
          }
        });

        eventRule.addTarget(new targets.LambdaFunction(lambdaAttachMultusEni));

        cdk.Tags.of(eventRule).add('Name', `${this.node.tryGetContext("cnf")}-ng-01`);

        //Create Lambda backed custom resource for auto-reboot
        const autoRebootPolicyStatement = new iam.PolicyStatement();
        autoRebootPolicyStatement.addActions("autoscaling:DescribeAutoScalingGroups",
          "ec2:TerminateInstances");
        autoRebootPolicyStatement.addResources("*")
        const lambdaAutoReboot = new lambda.Function(this, "LambdaAutoReboot", {
          runtime: lambda.Runtime.PYTHON_3_8,
          code: lambda.Code.fromAsset('lambda'),
          handler: 'auto-reboot.handler',
        });
        lambdaAutoReboot.addToRolePolicy(autoRebootPolicyStatement);

        new cdk.CustomResource(this, "CustomLambdaAutoReboot", {
          serviceToken: lambdaAutoReboot.functionArn,
          properties: {
            AsgName: asgName,
          }
        });
        // Needed to add this aws auth rolemapping for the nodegroup to join post lamdaauto-reboot
        cluster.awsAuth.addRoleMapping(iam.Role.fromRoleArn(this, "nodeArn", ng.role.roleArn.toString()), {
          username: "system:node:{{EC2PrivateDNSName}}",
          groups: ["system:bootstrappers", "system:nodes"]
        });
      }
    }
  }
}

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    new EksCluster(this, '  ', {
      vpc: getOrCreateVpc(this),
      //cluster: getOrCreateCluster(this),
    });

  }
}

const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

const stackName = app.node.tryGetContext('stackName') || 'cdk-eks-demo-stack';

new MyStack(app, stackName, {
  env: devEnv
});

app.synth();

function getOrCreateVpc(scope: Construct): ec2.IVpc {
  // use an existing vpc or create a new one
  return scope.node.tryGetContext('use_default_vpc') === '1' ?
    ec2.Vpc.fromLookup(scope, 'Vpc', {
      isDefault: true
    }) :
    scope.node.tryGetContext('use_vpc_id') ?
    ec2.Vpc.fromLookup(scope, 'Vpc', {
      vpcId: scope.node.tryGetContext('use_vpc_id')
    }) :
    new ec2.Vpc(scope, 'Vpc', {
      cidr: '172.16.0.0/16',
      natGateways: 1,
      subnetConfiguration: [{
          name: 'private-subnet-1',
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
          cidrMask: 19,
        },
        {
          name: 'public-subnet-1',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 19,
        },
      ],
    });
}