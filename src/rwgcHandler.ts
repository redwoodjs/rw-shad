import fs from 'fs'
import path from 'path'

import execa from 'execa'
import { Listr } from 'listr2'
import pascalcase from 'pascalcase'

import * as cliHelpers from '@redwoodjs/cli-helpers'
const { colors, getPaths, isTypeScriptProject } = cliHelpers.default

import type { CommandOptions } from './yargsTypes.js'

interface ErrorWithExitCode extends Error {
  exitCode?: number
}

function isErrorWithExitCode(e: unknown): e is ErrorWithExitCode {
  return typeof (e as ErrorWithExitCode)?.exitCode !== 'undefined'
}

interface Component {
  name: string
  dependencies?: string[] | undefined
  registryDependencies?: string[] | undefined
  files: string[]
  type: string
}

type Registry = Array<Component>

let registry: Registry = []

export const handler = async ({ components, force }: CommandOptions) => {
  // shadcn/ui uses kebab-case for component names
  let componentNames =
    components?.map((component) =>
      component.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
    ) ?? []

  const tasks = new Listr(
    [
      {
        title: 'Fetching registry...',
        task: async () => {
          const cachedRegistryPath = path.join(
            getPaths().generated.base,
            'shadcn',
            'registry.json',
          )

          if (fs.existsSync(cachedRegistryPath)) {
            const cachedRegistry = JSON.parse(
              fs.readFileSync(cachedRegistryPath, 'utf8'),
            )
            registry = cachedRegistry
          } else {
            const res = await fetch('https://ui.shadcn.com/registry/index.json')
            const json: any = await res.json()
            // Just a basic sanity check here
            if (
              Array.isArray(json) &&
              json.length > 10 &&
              json.every((component) => typeof component.name === 'string')
            ) {
              fs.writeFileSync(
                cachedRegistryPath,
                JSON.stringify(json, null, 2),
              )
              registry = json
            } else {
              throw new Error(
                'Invalid registry response:' +
                  JSON.stringify(json, undefined, 2),
              )
            }
          }
        },
      },
      {
        title: 'Component selection...',
        task: async (_ctx, task) => {
          const components = await task.prompt({
            type: 'multiselect',
            message: `Select the components you want to add (Press ${colors.green(
              '<space>',
            )} to select)`,
            footer: '\nEnter to confirm your choices and continue',
            name: 'name',
            required: true,
            // For Vim users (related: https://github.com/enquirer/enquirer/pull/163)
            j() {
              return this.down()
            },
            k() {
              return this.up()
            },
            indicator(_state: unknown, choice: any) {
              // The default ✓ indicator has bad accessibility
              return ` ${choice.enabled ? '●' : '○'}`
            },
            choices: registry.map((component) => ({
              message: titleCase(component.name),
              name: component.name,
            })),

            validate: (value) => {
              if (value.length < 1) {
                return 'You must choose at least one component.'
              }

              return true
            },
          })

          componentNames = components
        },
        enabled: () => {
          return componentNames.length === 0
        },
      },
      {
        title: 'Adding component(s)...',
        task: async () => {
          await execa(
            'npx',
            [
              'shadcn-ui@latest',
              'add',
              '--cwd',
              getPaths().web.config,
              '--path',
              path.join(getPaths().web.components, 'ui'),
              '--yes',
              force && '--overwrite',
              ...componentNames,
            ].filter(Boolean),
            process.env['RWJS_CWD']
              ? {
                  cwd: process.env['RWJS_CWD'],
                }
              : {},
          ).catch((error) => {
            if (error.stdout.includes('--overwrite')) {
              throw new Error(
                'Component already exists. Use --force to overwrite',
              )
            } else {
              throw error
            }
          })
        },
      },
      {
        title: 'Formatting source(s)...',
        task: () => {
          // TODO: Read from registry to only lint newly added files

          try {
            execa.commandSync(
              'yarn rw lint --fix ' +
                path.join(getPaths().web.components, 'ui'),
              process.env['RWJS_CWD']
                ? {
                    cwd: process.env['RWJS_CWD'],
                  }
                : {},
            )
          } catch {
            // Ignore errors here. The user will have to fix those manually for now
            // TODO: Print warning message if formatting failed
          }
        },
      },
      {
        title: 'Renaming file(s)...',
        task: () => {
          // TODO: Read from registry to rename all newly added files

          const ext = isTypeScriptProject() ? '.tsx' : '.jsx'

          componentNames?.forEach((componentName) => {
            const componentPath = path.join(
              getPaths().web.components,
              'ui',
              componentName + ext,
            )
            const pascalComponentPath = path.join(
              getPaths().web.components,
              'ui',
              pascalcase(componentName) + ext,
            )

            fs.renameSync(componentPath, pascalComponentPath)
          })
        },
      },
    ],
    { rendererOptions: { collapse: false } },
  )

  try {
    await tasks.run()
  } catch (e) {
    if (e instanceof Error) {
      console.error(colors.error(e.message))
    } else {
      console.error(colors.error('Unknown error when running yargs tasks'))
    }

    if (isErrorWithExitCode(e)) {
      process.exit(e.exitCode)
    }

    process.exit(1)
  }
}

function titleCase(str: string) {
  return str
    .split('-')
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ')
}
