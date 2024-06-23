import fs from 'fs'
import path from 'path'

import execa from 'execa'
import { Listr } from 'listr2'
import pascalcase from 'pascalcase'

import * as cliHelpers from '@redwoodjs/cli-helpers'
const { colors, getPaths, isTypeScriptProject } = cliHelpers.default

import type { CommandOptions } from './yargsTypes.js'

type Writeable<T> = { -readonly [P in keyof T]: T[P] }

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
          if (shouldUpdateRegistryCache()) {
            const res = await fetch('https://ui.shadcn.com/registry/index.json')
            const json: any = await res.json()
            // Just a basic sanity check here
            if (
              Array.isArray(json) &&
              json.length > 10 &&
              json.every((component) => typeof component.name === 'string')
            ) {
              registry = json

              fs.writeFileSync(
                getCachedRegistryPath(),
                JSON.stringify(json, null, 2),
              )
              fs.writeFileSync(
                getCacheMetadataPath(),
                JSON.stringify(
                  { timestamp: new Date().toISOString() },
                  null,
                  2,
                ),
              )
            } else {
              throw new Error(
                'Invalid registry response:' +
                  JSON.stringify(json, undefined, 2),
              )
            }
          } else {
            const cachedRegistry = JSON.parse(
              fs.readFileSync(getCachedRegistryPath(), 'utf8'),
            )
            registry = cachedRegistry
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
        task: async (ctx) => {
          const args = [
            'shadcn-ui@latest',
            'add',
            '--cwd',
            // Need to set --cwd to the config dir for shadcn to find the
            // config file
            getPaths().web.config,
            '--yes',
            force && '--overwrite',
            ...componentNames,
          ].filter(Boolean)

          const options: Writeable<execa.Options> = {}
          if (process.env['RWJS_CWD']) {
            options.cwd = process.env['RWJS_CWD']
          }

          await execa('npx', args, options).catch((error) => {
            if (error.stdout.includes('--overwrite')) {
              const msg = 'Component already exists. Use --force to overwrite'
              throw new Error(msg)
            } else {
              throw error
            }
          })

          const newComponents = new Map<string, Component>()

          componentNames.forEach((componentName) => {
            const component = registry.find((c) => c.name === componentName)

            if (component) {
              newComponents.set(componentName, component)
              component.registryDependencies?.forEach((depName) => {
                const dep = registry.find((c) => c.name === depName)
                if (dep) {
                  newComponents.set(depName, dep)
                }
              })
            }
          })

          ctx.newComponents = newComponents
        },
      },
      {
        title: 'Formatting source(s)...',
        task: () => {
          // TODO: use ctx.newComponents to only lint newly added files

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
        task: (ctx) => {
          ctx.newComponents.forEach((component) => {
            component.files.forEach((fileName) => {
              const ext = isTypeScriptProject()
                ? fileName.endsWith('.tsx')
                  ? '.tsx'
                  : '.ts'
                : fileName.endsWith('jsx')
                  ? '.jsx'
                  : '.js'

              const componentPath = path.join(
                getPaths().web.components,
                fileName.replace(/.tsx?/, ext),
              )
              const pascalComponentPath = path.join(
                getPaths().web.components,
                fileNameToPascalCase(fileName, ext),
              )

              fs.renameSync(componentPath, pascalComponentPath)
            })
          })
        },
      },
      {
        title: 'Updating import(s)...',
        task: (ctx) => {
          ctx.newComponents.forEach((component) => {
            component.files.forEach((fileName) => {
              const ext = isTypeScriptProject()
                ? fileName.endsWith('.tsx')
                  ? '.tsx'
                  : '.ts'
                : fileName.endsWith('jsx')
                  ? '.jsx'
                  : '.js'

              const pascalComponentPath = path.join(
                getPaths().web.components,
                fileNameToPascalCase(fileName, ext),
              )

              let src = fs.readFileSync(pascalComponentPath, 'utf-8')

              ctx.newComponents.forEach((component) => {
                component.files.forEach((fileName) => {
                  const importPath =
                    'src/components/' + fileName.replace(/.tsx?/, '')
                  const importPascalPath =
                    'src/components/' + fileNameToPascalCase(fileName, '')

                  const regExStr = `^import (.+) from '${importPath}'$`
                  const regExStrMultiline = `^} from '${importPath}'$`

                  // Using replaceAll to also handle separate type imports
                  src = src
                    .replaceAll(
                      new RegExp(regExStr, 'gm'),
                      `import $1 from '${importPascalPath}'`,
                    )
                    .replaceAll(
                      new RegExp(regExStrMultiline, 'gm'),
                      `} from '${importPascalPath}'`,
                    )
                })
              })

              fs.writeFileSync(pascalComponentPath, src)
            })
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

function fileNameToPascalCase(fileName: string, ext: string) {
  const parts = fileName.split('/')
  const componentFileName = parts.at(-1)?.replace(/.tsx?/, '')
  return path.join(...parts.slice(0, -1), pascalcase(componentFileName) + ext)
}

function getCachedRegistryPath() {
  return path.join(getPaths().generated.base, 'shadcn', 'registry.json')
}

function getCacheMetadataPath() {
  return path.join(getPaths().generated.base, 'shadcn', 'metadata.json')
}

function shouldUpdateRegistryCache() {
  if (!fs.existsSync(getCacheMetadataPath())) {
    return true
  }

  const metadata = JSON.parse(fs.readFileSync(getCacheMetadataPath(), 'utf-8'))

  const updatedAt = new Date(metadata.timestamp).getDate()

  if (new Date().getDate() < updatedAt) {
    // Something weird going on. Some timezone stuff maybe. Let's refetch just to be safe
    return true
  }

  const fiveMin = 5 * 60 * 1000
  if (new Date().getDate() > updatedAt + fiveMin) {
    // Cache is too old. Refetch
    return true
  }

  return !fs.existsSync(getCachedRegistryPath())
}
