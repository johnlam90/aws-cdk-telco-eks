# Telco Grade EKS cluster with CDK

![Screen_Shot_2021-10-26_at_12.43.18_AM](/uploads/ba9b997dbb7466734b8c14c176bf7374/Screen_Shot_2021-10-26_at_12.43.18_AM.png)

## Pre-requisites

- AWS Credentials

## Useage

Create vpc eks-cluster and NG

```bash
cdk deploy

```

Skip VPC creation and  use existing vpc-id

```bash
cdk deploy -c use_vpc_id=vpc-0b53e5c6c2d25d983

```

Create EKS cluster in existing VPC without Nodegroup

```bash
cdk deploy -c use_vpc_id=vpc-0b53e5c6c2d25d983 -c no_ng=1

```

Skipping Nodegroup - it will only create only VPC and Eks Control plane.

```bash
cdk deploy -c no_ng=1
```

Deploy Nodegroup without EFS filesystem

```bash
cdk deploy -c no_fs=1
```

Deploy Only VPC and Skip the rest of the deployment

```bash
cdk deploy -c only_vpc=1
```
