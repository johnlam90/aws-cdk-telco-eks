# Telco Grade EKS cluster with CDK

<img width="1220" alt="Screen_Shot_2021-10-26_at_12 43 18_AM" src="https://user-images.githubusercontent.com/8691485/139601728-2230f06e-f2a8-4046-937f-5993e7125840.png">

## Pre-requisites

- AWS Credentials
- Key-Pair 

## Useage

Create VPC,EKS cluster and Node Group

```bash
cdk deploy

```

Skip VPC creation and use existing VPC - Creates EKS Cluster and Node Group

```bash
cdk deploy -c use_vpc_id=vpc-0bxxxxxxxxxxx

```

Create EKS cluster in existing VPC without Nodegroup

```bash
cdk deploy -c use_vpc_id=vpc-0bxxxxxxxxxxx -c no_ng=1

```

Skip Nodegroup - Creates only VPC and EKS Control plane.

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
