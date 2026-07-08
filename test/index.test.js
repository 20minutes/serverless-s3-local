const { EventEmitter } = require('node:events')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3')
const ServerlessS3Local = require('../src')

const waitFor = async (assertion, timeout = 1000) => {
  const start = Date.now()
  let lastError

  while (Date.now() - start < timeout) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  assertion()
  throw lastError
}

const makeServerless = ({ custom = {}, functions = {}, plugins = [], resources = {} } = {}) => {
  const service = {
    custom,
    functions,
    plugins,
    provider: {
      runtime: 'nodejs24.x',
      environment: {},
    },
    resources: {
      Resources: resources,
    },
    getAllFunctions() {
      return Object.keys(functions)
    },
    getFunction(name) {
      return functions[name]
    },
  }

  return {
    cli: {
      log: vi.fn(),
    },
    config: {
      servicePath: process.cwd(),
    },
    service,
  }
}

const makePlugin = (serverless = makeServerless(), options = {}) =>
  new ServerlessS3Local(serverless, {
    buckets: [],
    ...options,
  })

describe('ServerlessS3Local', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('merges default, serverless-offline, CLI, and custom S3 options', () => {
    const serverless = makeServerless({
      custom: {
        'serverless-offline': {
          host: '0.0.0.0',
        },
        s3: {
          port: 9000,
          directory: '/tmp/s3',
        },
      },
    })
    const plugin = makePlugin(serverless, {
      port: 8000,
      silent: true,
    })

    plugin.setOptions()

    expect(plugin.options).toMatchObject({
      address: 'localhost',
      host: '0.0.0.0',
      port: 9000,
      directory: '/tmp/s3',
      silent: true,
    })
  })

  it('collects buckets from resources, CLI options, and S3 events', () => {
    const serverless = makeServerless({
      functions: {
        upload: {
          events: [
            {
              s3: 'event-bucket',
            },
          ],
        },
      },
      resources: {
        AssetBucket: {
          Type: 'AWS::S3::Bucket',
          Properties: {
            BucketName: 'resource-bucket',
          },
        },
      },
    })
    const plugin = makePlugin(serverless, {
      buckets: ['cli-bucket'],
    })

    expect(plugin.buckets()).toEqual(['resource-bucket', 'cli-bucket', 'event-bucket'])
  })

  it('collects buckets from additional stacks', () => {
    const serverless = makeServerless({
      custom: {
        additionalStacks: {
          permanent: {
            Resources: {
              DataBucket: {
                Type: 'AWS::S3::Bucket',
                Properties: {
                  BucketName: 'additional-bucket',
                },
              },
            },
          },
        },
      },
      plugins: ['serverless-plugin-additional-stacks'],
    })
    const plugin = makePlugin(serverless)

    expect(plugin.buckets()).toContain('additional-bucket')
  })

  it('collects buckets from existingS3 events', () => {
    const serverless = makeServerless({
      functions: {
        upload: {
          events: [
            {
              existingS3: {
                bucket: 'existing-bucket',
              },
            },
          ],
        },
      },
      plugins: ['serverless-plugin-existing-s3'],
    })
    const plugin = makePlugin(serverless)

    expect(plugin.buckets()).toContain('existing-bucket')
  })

  it('does not mutate resources and deduplicates collected buckets', () => {
    const resources = {
      AssetBucket: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          BucketName: 'shared-bucket',
        },
      },
    }
    const serverless = makeServerless({
      custom: {
        additionalStacks: {
          permanent: {
            Resources: {
              AddedBucket: {
                Type: 'AWS::S3::Bucket',
                Properties: {
                  BucketName: 'added-bucket',
                },
              },
            },
          },
        },
      },
      functions: {
        upload: {
          events: [{ s3: 'shared-bucket' }],
        },
      },
      plugins: ['serverless-plugin-additional-stacks'],
      resources,
    })
    const plugin = makePlugin(serverless, {
      buckets: ['shared-bucket'],
    })

    expect(plugin.buckets()).toEqual(['shared-bucket', 'added-bucket'])
    expect(resources).not.toHaveProperty('AddedBucket')
  })

  it('matches prefix and suffix rules', () => {
    const handler = ServerlessS3Local.buildEventHandler(
      'bucket',
      'ObjectCreated:.*',
      [{ prefix: 'incoming/' }, { suffix: '.jpg' }],
      vi.fn()
    )

    expect(ServerlessS3Local.rulesMatch(handler.rules, 'incoming/img.jpg')).toBe(true)
    expect(ServerlessS3Local.rulesMatch(handler.rules, 'incoming/img.png')).toBe(false)
    expect(ServerlessS3Local.rulesMatch(handler.rules, 'other/img.jpg')).toBe(false)
    expect(ServerlessS3Local.rulesMatch(handler.rules, 'incoming/imgxjpg')).toBe(false)
  })

  it('subscribes to matching S3 events without RxJS', () => {
    const plugin = makePlugin()
    const func = vi.fn()
    plugin.client = new EventEmitter()
    plugin.getEventHandlers = () => [
      ServerlessS3Local.buildEventHandler(
        'local-bucket',
        'ObjectCreated:.*',
        [{ prefix: 'incoming/' }],
        func
      ),
    ]

    plugin.subscribe()
    plugin.client.emit('event', {
      Records: [
        {
          eventName: 'ObjectCreated:Put',
          s3: {
            bucket: {
              name: 'local-bucket',
            },
            object: {
              key: 'incoming/file.txt',
            },
          },
        },
      ],
    })

    expect(func).toHaveBeenCalledTimes(1)

    plugin.unsubscribe()
    plugin.client.emit('event', {
      Records: [
        {
          eventName: 'ObjectCreated:Put',
          s3: {
            bucket: {
              name: 'local-bucket',
            },
            object: {
              key: 'incoming/other.txt',
            },
          },
        },
      ],
    })

    expect(func).toHaveBeenCalledTimes(1)
  })

  it('refreshes S3 event listeners after webpack recompiles', async () => {
    const plugin = makePlugin()
    plugin.client = new EventEmitter()
    plugin.s3eventListener = vi.fn()
    plugin.unsubscribe = vi.fn()
    plugin.subscribe = vi.fn()

    await plugin.subscriptionWebpackHandler()

    expect(plugin.unsubscribe).toHaveBeenCalledTimes(1)
    expect(plugin.subscribe).toHaveBeenCalledTimes(1)
    expect(plugin.serverless.cli.log).toHaveBeenCalledWith('S3 event listeners refreshed')
  })

  it('creates buckets through AWS SDK client', async () => {
    const plugin = makePlugin(undefined, {
      buckets: ['local-bucket'],
    })
    const send = vi.fn().mockResolvedValue({})
    plugin.getClient = () => ({ send })

    await plugin.createBuckets()

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].input).toEqual({
      Bucket: 'local-bucket',
    })
  })

  it('ignores already-owned bucket errors and propagates other create failures', async () => {
    const plugin = makePlugin(undefined, {
      buckets: ['local-bucket'],
    })
    const send = vi.fn().mockRejectedValue(
      Object.assign(new Error('owned'), {
        name: 'BucketAlreadyOwnedByYou',
      })
    )
    plugin.getClient = () => ({ send })

    await expect(plugin.createBuckets()).resolves.toHaveLength(1)

    send.mockRejectedValue(
      Object.assign(new Error('denied'), {
        name: 'AccessDenied',
      })
    )

    await expect(plugin.createBuckets()).rejects.toThrow('denied')
  })

  it('removes paginated bucket objects before deleting the bucket', async () => {
    const plugin = makePlugin(undefined, {
      buckets: ['local-bucket'],
    })
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Contents: [{ Key: 'first.txt' }],
        NextContinuationToken: 'next',
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Contents: [{ Key: 'second.txt' }],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
    plugin.getClient = () => ({ send })

    await plugin.removeBuckets()

    expect(send).toHaveBeenCalledTimes(5)
    expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      'ListObjectsV2Command',
      'DeleteObjectsCommand',
      'ListObjectsV2Command',
      'DeleteObjectsCommand',
      'DeleteBucketCommand',
    ])
    expect(send.mock.calls[2][0].input).toMatchObject({
      Bucket: 'local-bucket',
      ContinuationToken: 'next',
    })
  })

  it('does not crash when plugins or function events are missing', () => {
    const serverless = makeServerless({
      functions: {
        upload: {},
      },
    })
    delete serverless.service.plugins

    const plugin = makePlugin(serverless)

    expect(plugin.hasPlugin('missing')).toBe(false)
    expect(plugin.buckets()).toEqual([])
  })

  it('logs rejected handlers and restores process environment', async () => {
    const originalExisting = process.env.EXISTING_ENV
    const originalNew = process.env.NEW_ENV
    process.env.EXISTING_ENV = 'original'
    delete process.env.NEW_ENV

    const runHandler = vi.fn().mockRejectedValue(new Error('handler failed'))
    class LambdaHandler {
      create() {}

      get() {
        return {
          setEvent: vi.fn(),
          runHandler,
        }
      }
    }
    const serverless = makeServerless({
      functions: {
        upload: {
          environment: {
            EXISTING_ENV: 'changed',
            NEW_ENV: 'created',
          },
          events: [{ s3: 'local-bucket' }],
        },
      },
    })
    const plugin = makePlugin(serverless)
    plugin.lambdaHandler = LambdaHandler

    const [handler] = plugin.getEventHandlers()
    await handler.func({ Records: [] })

    expect(runHandler).toHaveBeenCalledTimes(1)
    expect(serverless.cli.log).toHaveBeenCalledWith(
      'Error while running handler',
      expect.any(Error)
    )
    expect(process.env.EXISTING_ENV).toBe('original')
    expect(process.env.NEW_ENV).toBeUndefined()

    if (originalExisting === undefined) {
      delete process.env.EXISTING_ENV
    } else {
      process.env.EXISTING_ENV = originalExisting
    }
    if (originalNew === undefined) {
      delete process.env.NEW_ENV
    } else {
      process.env.NEW_ENV = originalNew
    }
  })

  it('starts and stops a local S3 server without Docker', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'serverless-s3-local-'))
    const serverless = makeServerless({
      custom: {
        s3: {
          address: '127.0.0.1',
          host: '127.0.0.1',
          port: 0,
          directory,
          silent: true,
          allowMismatchedSignatures: true,
        },
      },
      functions: {},
    })
    const plugin = makePlugin(serverless)

    try {
      await plugin.startHandler()

      expect(plugin.client).toBeTruthy()
      expect(plugin.options.port).toEqual(expect.any(Number))
      expect(plugin.options.port).toBeGreaterThan(0)
      expect(serverless.cli.log).toHaveBeenCalledWith('starting handler')
    } finally {
      plugin.endHandler()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('can stop without a running S3 server', () => {
    const plugin = makePlugin()
    plugin.setOptions()

    expect(() => plugin.endHandler()).not.toThrow()
  })

  it('runs a lambda handler after an S3 put event', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'serverless-s3-local-'))
    const runHandler = vi.fn().mockResolvedValue()
    const setEvent = vi.fn()
    class LambdaHandler {
      create() {}

      get() {
        return {
          setEvent,
          runHandler,
        }
      }
    }
    const serverless = makeServerless({
      custom: {
        s3: {
          address: '127.0.0.1',
          host: '127.0.0.1',
          port: 0,
          directory,
          silent: true,
          allowMismatchedSignatures: true,
        },
      },
      functions: {
        upload: {
          handler: 'handler.upload',
          events: [
            {
              s3: {
                bucket: 'local-bucket',
                event: 's3:ObjectCreated:Put',
                rules: [{ prefix: 'incoming/' }, { suffix: '.txt' }],
              },
            },
          ],
        },
      },
    })
    const plugin = makePlugin(serverless)

    try {
      await plugin.startHandler()
      plugin.unsubscribe()
      plugin.lambdaHandler = LambdaHandler
      plugin.subscribe()

      const client = new S3Client({
        forcePathStyle: true,
        endpoint: `http://127.0.0.1:${plugin.options.port}`,
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'S3RVER',
          secretAccessKey: 'S3RVER',
        },
      })

      await client.send(
        new PutObjectCommand({
          Bucket: 'local-bucket',
          Key: 'incoming/file.txt',
          Body: 'content',
        })
      )

      await waitFor(() => expect(runHandler).toHaveBeenCalledTimes(1))
      expect(setEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          Records: [
            expect.objectContaining({
              eventName: 'ObjectCreated:Put',
              s3: expect.objectContaining({
                bucket: expect.objectContaining({ name: 'local-bucket' }),
                object: expect.objectContaining({ key: 'incoming/file.txt' }),
              }),
            }),
          ],
        })
      )
    } finally {
      plugin.endHandler()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
