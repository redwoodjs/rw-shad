import fs from 'fs'
import path from 'path'

import execa from 'execa'
import { Listr } from 'listr2'
import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer'
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

              fs.mkdirSync(path.dirname(getCachedRegistryPath()), {
                recursive: true,
              })
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
          const prompt = task.prompt(ListrEnquirerPromptAdapter)
          const components = await prompt.run({
            type: 'multiselect',
            message: `Select the components you want to add (Press ${colors.green(
              '<space>',
            )} to select)`,
            footer: '\nEnter to confirm your choices and continue',
            name: 'name',
            required: true,
            // This is a workaround for https://github.com/enquirer/enquirer/issues/426
            limit: process.stdout.rows - 7,
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
        task: async (ctx, task) => {
          componentNames.forEach((componentName) => {
            const component = registry.find((c) => c.name === componentName)

            if (component) {
              ctx.newComponents.set(componentName, component)
              component.registryDependencies?.forEach((depName) => {
                const dep = registry.find((c) => c.name === depName)
                if (dep) {
                  ctx.newComponents.set(depName, dep)
                }
              })
            } else {
              throw new Error(
                `Component "${componentName}" not found in registry`,
              )
            }
          })

          const existingComponents = getPreExistingComponents(ctx.newComponents)

          if (!force) {
            existingComponents.forEach((component) => {
              ctx.newComponents.delete(component.name)
            })

            if (existingComponents.length > 0) {
              // TODO: Only output names of "top level" components (those that
              // are part of `componentName`) and/or say "skipping existing
              // dependency <component name>"
              task.output =
                existingComponents.length === 1
                  ? 'Skipping existing component:'
                  : 'Skipping existing components:'
              task.output = existingComponents
                .map((component) => component.name)
                .join(', ')
            }
          }

          if (ctx.newComponents.size === 0) {
            return
          }

          const args = [
            '--yes',
            'https://verdaccio.tobbe.dev/shadcn/-/shadcn-2.1.2-tobbe-20241029-0244.tgz',
            'add',
            '--cwd',
            // shadcn will look for a package.json in this directory
            getPaths().web.base,
            '--config-dir',
            // This is where shadcn should look for components.json
            path.relative(getPaths().web.base, getPaths().web.config),
            force && '--overwrite',
            ...ctx.newComponents.keys(),
          ].filter((n?: string | false): n is string => Boolean(n))

          const options: Writeable<execa.Options> = { stdio: 'pipe' }
          if (process.env['RWJS_CWD']) {
            options.cwd = process.env['RWJS_CWD']
          }

          // If shadcn changes something and we get a prompt this will hang
          // forever. The user will probably press Ctrl+C and hopefully report
          // the issue to us. To aid in debugging I want to know what the
          // prompt was. So we capture all output and if we receive an 'exit'
          // signal we throw an error with the captured output.
          const npxProcess = execa('npx', args, options)

          const output: Buffer[] = []

          npxProcess.stdout?.on('data', (data) => {
            output.push(data)
          })
          npxProcess.stdout?.on('error', (error) => {
            output.push(Buffer.from(error.message))
          })
          npxProcess.stderr?.on('data', (data) => {
            output.push(data)
          })

          const exitListener = () => {
            const unexpectedOutput = Buffer.concat(output).toString('utf-8')
            throw new Error('Unexpected output\n' + unexpectedOutput)
          }

          process.addListener('exit', exitListener)

          await npxProcess

          process.removeListener('exit', exitListener)
        },
        rendererOptions: {
          outputBar: Infinity,
          persistentOutput: true,
        },
      },
      {
        title: '',
        enabled: (ctx) => ctx.newComponents.size === 0,
        task: (_ctx, task) => {
          // Only have this task to get the output I want when there
          // are no new components to add
          // Can't have an initial title because then that will be shown (with a
          // grey icon) while previous tasks are running
          task.title = 'No new components to add'
        },
        rendererOptions: {
          persistentOutput: false,
        },
      },
      {
        title: 'Formatting source(s)...',
        enabled: (ctx) => ctx.newComponents.size > 0,
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
        enabled: (ctx) => ctx.newComponents.size > 0,
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
        enabled: (ctx) => ctx.newComponents.size > 0,
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
    {
      rendererOptions: {
        collapseSubtasks: false,
        showSkipMessage: true,
        collapseSkips: false,
      },
      ctx: {
        newComponents: new Map<string, Component>(),
      },
    },
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

  const updatedAt = new Date(metadata.timestamp).getTime()

  if (new Date().getTime() < updatedAt) {
    // Something weird going on. Some timezone stuff maybe. Let's refetch just to be safe
    return true
  }

  const fiveMin = 5 * 60 * 1000
  if (new Date().getTime() > updatedAt + fiveMin) {
    // Cache is too old. Refetch
    return true
  }

  return !fs.existsSync(getCachedRegistryPath())
}

function getPreExistingComponents(newComponents: Map<string, Component>) {
  const existing = Array.from(newComponents.values()).filter((component) => {
    const firstFileName = component.files[0]

    if (!firstFileName) {
      return false
    }

    const ext = isTypeScriptProject()
      ? firstFileName.endsWith('.tsx')
        ? '.tsx'
        : '.ts'
      : firstFileName.endsWith('jsx')
        ? '.jsx'
        : '.js'

    const pascalComponentPath = path.join(
      getPaths().web.components,
      fileNameToPascalCase(firstFileName, ext),
    )

    return fs.existsSync(pascalComponentPath)
  })

  return existing
}
