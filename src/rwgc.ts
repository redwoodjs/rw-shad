import type Yargs from 'yargs'

interface BaseOptions {
  cwd: string | undefined
}

interface CommandOptions extends BaseOptions {
  component: string
  force: boolean
}

export const scriptName = 'rwgc'

// TODO: Handle list (array) of components
export const command = '$0 <component>'

export const description = 'Generate a component'

export const builder = (yargs: Yargs.Argv<BaseOptions>) => {
  return yargs
    .positional('component', {
      description: 'The component you want to add',
      type: 'string',
      default: '',
    })
    .option('force', {
      alias: 'f',
      default: false,
      description: 'Overwrite existing component',
      type: 'boolean',
    })
}

export const handler = async (options: CommandOptions) => {
  const { handler } = await import('./rwgcHandler')
  return handler(options)
}
