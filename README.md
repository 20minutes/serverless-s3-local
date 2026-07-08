# @20minutes/serverless-s3-local

[![CI](https://github.com/20minutes/serverless-s3-local/actions/workflows/ci.yml/badge.svg)](https://github.com/20minutes/serverless-s3-local/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/@20minutes%2Fserverless-s3-local.svg)](https://badge.fury.io/js/@20minutes%2Fserverless-s3-local)
[![npm downloads](https://img.shields.io/npm/dt/@20minutes%2Fserverless-s3-local.svg?style=flat)](https://www.npmjs.com/package/@20minutes%2Fserverless-s3-local)
[![MIT licensed](https://img.shields.io/badge/license-MIT-blue.svg)](https://raw.githubusercontent.com/amplify-education/serverless-domain-manager/master/LICENSE)

Forked version to use our own fork of s3rver (and removed Docker).

For the official readme, [check the official project](https://github.com/ar90n/serverless-s3-local).

## Requirements

- Node.js >= 24
- Serverless Framework
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

- `host`: S3 endpoint host used by SDK clients. Default: `localhost`
- `address`: bind address used by S3rver. Default: `localhost`
- `port`: S3 endpoint port. Default: `4569`
- `directory`: local object storage directory. Default: `./buckets`
- `buckets`: extra buckets to create
- `noStart`: create/remove buckets against already running local S3
- `accessKeyId`: local credentials. Default: `S3RVER`
- `secretAccessKey`: local credentials. Default: `S3RVER`
- `region`: SDK region. Default: `us-east-1`
- `cors`: path to CORS XML config
- `website`: path to website XML config
- `allowMismatchedSignatures`: pass-through S3rver option
- `serviceEndpoint`: pass-through S3rver option
- `httpsProtocol`: directory containing `cert.pem` and `key.pem`
- `vhostBuckets`: pass-through S3rver option

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
