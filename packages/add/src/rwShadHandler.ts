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

interface File {
  path: string
  type: string
  content: string
  target?: string
  rwPath?: string
}

interface Component {
  name: string
  dependencies?: string[] | undefined
  registryDependencies?: string[] | undefined
  files: File[]
  type: string
}

type Registry = Array<Component>

const REGISTRY_URL = process.env['REGISTRY_URL'] ?? 'https://ui.shadcn.com/r'

// TODO: Read from components.json
// path.join(getPaths().web.config, 'components.json')
const config = {
  style: 'default',
}

let registry: Registry = []
let registryR: Registry = []

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
            // TODO: /r/index.json
            //       /r/colors/index.json
            //       /r/colors/[baseColor].json
            //       /r/styles/index.json
            //       /r/styles/[style]/index.json
            //       /r/styles/[style]/[name].json (/r/styles/default/use-mobile.json)
            //       /r/themes.css
            //       /r/themes/[theme].json (/r/themes/slate.json)
            // Look in the shadcn-ui public/r/ folder for all files
            // async function resolveDependencies(itemUrl: string) {
            //   const url = getRegistryUrl(
            //     isUrl(itemUrl) ? itemUrl : `styles/${config.style}/${itemUrl}.json`
            //   )
            const res = await fetch(REGISTRY_URL + '/index.json')
            const json: any = await res.json()
            // Just a basic sanity check here
            if (
              Array.isArray(json) &&
              json.length > 10 &&
              json.every((component) => isComponent(component))
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
          await Promise.all(
            componentNames.map(async (componentName) => {
              const component = registry.find((c) => c.name === componentName)

              if (component) {
                ctx.newComponents.set(componentName, component)
                component.registryDependencies?.forEach((depName) => {
                  // TODO: This is a bit broken. Will not find all new components
                  // like hooks. It should look for styles/[style]/[name].json
                  // Shad has changed things up a bit
                  const dep = registry.find((c) => c.name === depName)
                  if (dep) {
                    ctx.newComponents.set(depName, dep)
                  }
                })
              } else {
                try {
                  const res = await fetch(getRegistryUrl(componentName))

                  if (!res.ok) {
                    throw new Error(
                      `!res.ok. Component "${componentName}" not found in registry`,
                    )
                  }

                  const json: any = await res.json()

                  if (isComponent(json)) {
                    const component = json as Component

                    registryR.push(json)

                    ctx.newComponents.set(componentName, json)
                    component.registryDependencies?.forEach((depName) => {
                      // TODO: This is a bit broken. Will not find all new components
                      // like hooks. It should look for styles/[style]/[name].json
                      // Shad has changed things up a bit
                      const dep = registry.find((c) => c.name === depName)
                      if (dep) {
                        ctx.newComponents.set(depName, dep)
                      }
                    })

                    return
                  } else {
                    throw new Error(
                      `invalid json. Component "${componentName}" not found in registry`,
                    )
                  }
                } catch (e) {
                  console.error(e)
                  throw new Error(
                    `exception: Component "${componentName}" not found in registry`,
                  )
                }
              }
            }),
          )

          // TODO: Not everything in `newComponents` are really "components".
          // Some are for example hooks, so `getPreExistingComponents` won't
          // find them. Need to figure out if I should update the function to
          // handle this, or if I should add a separate function for hooks etc.
          // (currenly hooks aren't actually supported, but that's a separate
          // TODO. See above)
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
            'https://verdaccio.tobbe.dev/shadcn/-/shadcn-2.1.2-tobbe-20241101-0945.tgz',
            'add',
            '--cwd',
            // shadcn will look for a package.json in this directory
            getPaths().web.base,
            '--config-dir',
            // This is where shadcn should look for components.json
            path.relative(getPaths().web.base, getPaths().web.config),
            force ? '--overwrite' : '--no-overwrite',
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

          // TODO: This can take a while if there are many components to add.
          // There is a spinner, but the user might still think that it'll just
          // sit there and spin forever. We should have some kind of better
          // feedback to the user.
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
        title: 'Renaming file(s)...',
        enabled: (ctx) => ctx.newComponents.size > 0,
        task: (ctx) => {
          ctx.newComponents.forEach((component) => {
            component.files.forEach((file) => {
              const fileName =
                file.type === 'registry:ui'
                  ? file.path
                  : (file.target || file.path)
                      ?.split('/')
                      ?.at(file.type === 'registry:page' ? -2 : -1)

              if (!fileName) {
                throw new Error(
                  `Could not determine file name for: ${JSON.stringify(file)}`,
                )
              }

              const ext = isTypeScriptProject()
                ? (file.target || file.path).endsWith('.tsx')
                  ? '.tsx'
                  : '.ts'
                : (file.target || file.path).endsWith('jsx')
                  ? '.jsx'
                  : '.js'

              const componentPath = path.join(
                getShadTargetDir(file),
                (file.target || fileName).replace(/\.tsx?/, ext),
              )
              const pascalComponentPath = path.join(
                getTargetDir(file),
                fileNameToPascalCase(fileName, ext),
              )

              fs.renameSync(componentPath, pascalComponentPath)
              file.rwPath = pascalComponentPath
            })
          })
        },
      },
      {
        title: 'Formatting source(s)...',
        enabled: (ctx) => ctx.newComponents.size > 0,
        task: (ctx) => {
          // TODO: use ctx.newComponents to only lint newly added files
          // And/or use `git diff` to figure out what files needs to be linted
          // (just have to check that git is available and that git has been
          // initialized in the project first)

          // TODO: Change "import * as React ..." to "import React ..."

          const twConfigPath = path.join(
            getPaths().web.config,
            'tailwind.config.js',
          )

          const newComponentPaths = Array.from(ctx.newComponents.values())
            .map((component) => component.files.map((file) => file.rwPath))
            .flat()
            .join(' ')

          try {
            execa.commandSync(
              `yarn rw lint --fix ${newComponentPaths} ${twConfigPath}`,
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
        title: 'Updating import(s)...',
        enabled: (ctx) => ctx.newComponents.size > 0,
        task: (ctx) => {
          ctx.newComponents.forEach((component) => {
            component.files.forEach((file) => {
              if (!file.rwPath) {
                throw new Error('No rwPath on file' + JSON.stringify(file))
              }

              const src = fs.readFileSync(file.rwPath, 'utf-8')

              const regExStr = `^import (.+) from '(src\/components\/.+)'$`
              const regExStrMultiline = `^} from '(src\/components\/.+)'$`

              // Using replaceAll to also handle separate type imports
              const updatedSrc = src
                .replaceAll(
                  new RegExp(regExStr, 'gm'),
                  function (_match, p1, p2) {
                    return `import ${p1} from '${fileNameToPascalCase(p2, '')}'`
                  },
                )
                .replaceAll(
                  new RegExp(regExStrMultiline, 'gm'),
                  function (_match, p1) {
                    return `} from '${fileNameToPascalCase(p1, '')}'`
                  },
                )

              fs.writeFileSync(file.rwPath, updatedSrc)
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
    const firstFile = component.files[0]

    if (!firstFile || !firstFile.path) {
      return false
    }

    const firstFileName = firstFile.path

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

// This is copy/pasted from shad's implementation
// https://github.com/shadcn-ui/ui/blob/500a353816969e3cce2b3f4f0699ce4e6ad06f0b/packages/shadcn/src/utils/registry/index.ts#L445
function isUrl(path: string) {
  try {
    new URL(path)
    return true
  } catch (error) {
    return false
  }
}

// This is based on shad's implementation
// https://github.com/shadcn-ui/ui/blob/500a353816969e3cce2b3f4f0699ce4e6ad06f0b/packages/shadcn/src/utils/registry/index.ts#L430
function getRegistryUrl(component: string) {
  if (isUrl(component)) {
    // If the url contains /chat/b/, we assume it's the v0 registry.
    // We need to add the /json suffix if it's missing.
    const url = new URL(path)
    if (url.pathname.match(/\/chat\/b\//) && !url.pathname.endsWith('/json')) {
      url.pathname = `${url.pathname}/json`
    }

    return url.toString()
  }

  // TODO: Pass `config` as an argument to getRegistryUrl
  return `${REGISTRY_URL}/styles/${config.style}/${component}.json`
}

function isComponent(json: unknown): json is Component {
  return !!(
    json &&
    typeof json === 'object' &&
    'name' in json &&
    'files' in json &&
    Array.isArray(json.files) &&
    'type' in json
  )
}

function getTargetDir(file: File) {
  if (file.target) {
    switch (file.type) {
      case 'registry:ui':
      case 'registry:block':
      case 'registry:component':
        return getPaths().web.components
      case 'registry:lib':
        return path.join(getPaths().web.src, 'utils')
      case 'registry:hooks':
        return path.join(getPaths().web.src, 'hooks')
      case 'registry:page':
        return path.join(getPaths().web.pages)
      default:
        throw new Error(`Unknown file type for: ${JSON.stringify(file)}`)
    }
  }

  return getPaths().web.components
}

function getShadTargetDir(file: File) {
  if (file.target) {
    switch (file.type) {
      case 'registry:ui':
        return getPaths().web.components
      case 'registry:block':
      case 'registry:component':
        return getPaths().web.components
      case 'registry:lib':
        return path.join(getPaths().web.src, 'utils')
      case 'registry:hooks':
        return path.join(getPaths().web.src, 'hooks')
      case 'registry:page':
        return getPaths().web.src
      default:
        throw new Error(`Unknown file type for: ${JSON.stringify(file)}`)
    }
  }

  return getPaths().web.components
}
