import type Yargs from 'yargs'

interface BaseOptions {
  cwd: string | undefined
}

interface ForceOptions extends BaseOptions {
  force: boolean
}

export const scriptName = "rw-setup-rwgc"

export const description = 'Set up rwgc'

export const builder = (yargs: Yargs.Argv<BaseOptions>) => {
  return yargs.option('force', {
    alias: 'f',
    default: false,
    description: 'Overwrite existing configuration',
    type: 'boolean',
  })
}

export const handler = async (options: ForceOptions) => {
  const { handler } = await import('./rwgcSetupHandler')
  return handler(options)
}
