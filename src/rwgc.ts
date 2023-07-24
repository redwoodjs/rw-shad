import type Yargs from 'yargs'
import type { BaseOptions, CommandOptions } from './yargsTypes'

export const scriptName = 'rwgc'

export const command = '$0 [components..]'

export const description = 'Generate one or more components'

export const builder = (yargs: Yargs.Argv<BaseOptions>) => {
  return yargs
    .positional('components', {
      description: 'The components you want to add',
      type: 'string',
      array: true,
    })
    .option('force', {
      alias: 'f',
      default: false,
      description: 'Overwrite existing components',
      type: 'boolean',
    })
}

export const handler = async (options: CommandOptions) => {
  const { handler } = await import('./rwgcHandler')
  return handler(options)
}
