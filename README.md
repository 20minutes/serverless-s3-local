# @20minutes/serverless-s3-local

[![CI](https://github.com/20minutes/serverless-s3-local/actions/workflows/ci.yml/badge.svg)](https://github.com/20minutes/serverless-s3-local/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/@20minutes%2Fserverless-s3-local.svg)](https://badge.fury.io/js/@20minutes%2Fserverless-s3-local)
[![npm downloads](https://img.shields.io/npm/dt/@20minutes%2Fserverless-s3-local.svg?style=flat)](https://www.npmjs.com/package/@20minutes%2Fserverless-s3-local)
[![MIT licensed](https://img.shields.io/badge/license-MIT-blue.svg)](https://raw.githubusercontent.com/amplify-education/serverless-domain-manager/master/LICENSE)

Forked version to use our own fork of s3rver (and removed Docker).

For the official readme, [check the official project](https://github.com/ar90n/serverless-s3-local).

## Requirements

- Node.js >= 24
- Serverless Framework v3 or osls v3
- `serverless-offline` when using S3 events with offline lambdas

## Installation

```bash
yarn add -D @20minutes/serverless-s3-local serverless-offline
```

## Configuration

```yaml
service: my-service

provider:
  name: aws
  runtime: nodejs24.x

plugins:
  - '@20minutes/serverless-s3-local'
  - serverless-offline

custom:
  s3:
    host: localhost
    port: 8000
    directory: ./.s3-local

resources:
  Resources:
    LocalBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: local-bucket

functions:
  onUpload:
    handler: handler.onUpload
    events:
      - s3:
          bucket: local-bucket
          event: s3:ObjectCreated:Put
          rules:
            - prefix: incoming/
            - suffix: .txt
```

## Commands

```bash
serverless s3 start
serverless s3 create
serverless s3 remove
serverless offline start
```

## Options

Common `custom.s3` options:

| Option | Description | Default |
| --- | --- | --- |
| `host` | S3 endpoint host used by SDK clients | `localhost` |
| `address` | Bind address used by S3rver | `localhost` |
| `port` | S3 endpoint port | `4569` |
| `directory` | Local object storage directory | `./buckets` |
| `buckets` | Extra buckets to create | none |
| `noStart` | Create/remove buckets against already running local S3 | `false` |
| `accessKeyId` | Local credentials access key | `S3RVER` |
| `secretAccessKey` | Local credentials secret key | `S3RVER` |
| `region` | SDK region | `us-east-1` |
| `cors` | Path to CORS XML config | none |
| `website` | Path to website XML config | none |
| `allowMismatchedSignatures` | Pass-through S3rver option | `false` |
| `serviceEndpoint` | Pass-through S3rver option | none |
| `httpsProtocol` | Directory containing `cert.pem` and `key.pem` | none |
| `vhostBuckets` | Pass-through S3rver option | `true` |

## SDK Client

```js
const { S3Client } = require('@aws-sdk/client-s3')

const s3 = new S3Client({
  forcePathStyle: true,
  endpoint: 'http://localhost:8000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'S3RVER',
    secretAccessKey: 'S3RVER',
  },
})
```

## Development

```bash
yarn install
yarn lint
yarn test
```

## Examples

Two examples are kept as runnable documentation:

- `examples/simple-put`
- `examples/s3-event-prefix-suffix`
