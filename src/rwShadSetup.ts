import type Yargs from 'yargs'

interface BaseOptions {
  cwd: string | undefined
}

interface ForceOptions extends BaseOptions {
  force: boolean
}

export const scriptName = "setup-rw-shad"

export const description = 'Setup rw-shad'

export const builder = (yargs: Yargs.Argv<BaseOptions>) => {
  return yargs.option('force', {
    alias: 'f',
    default: false,
    description: 'Overwrite existing configuration',
    type: 'boolean',
  })
}

export const handler = async (options: ForceOptions) => {
  const { handler } = await import('./rwShadSetupHandler')
  return handler(options)
}
