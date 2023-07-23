import fs from 'fs'
import path from 'path'

import execa from 'execa'
import { Listr } from 'listr2'
import pascalcase from 'pascalcase'

import { colors, getPaths } from '@redwoodjs/cli-helpers'

interface ErrorWithExitCode extends Error {
  exitCode?: number
}

function isErrorWithExitCode(e: unknown): e is ErrorWithExitCode {
  return typeof (e as ErrorWithExitCode)?.exitCode !== 'undefined'
}

export const handler = async ({
  component,
  force,
}: {
  component: string
  force: boolean
}) => {
  // shadcn/ui uses kebab-case for component names
  const componentName = component
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()

  const tasks = new Listr(
    [
      {
        title: 'Adding component...',
        task: async () => {
          await execa(
            'npx',
            [
              'shadcn-ui@latest',
              'add',
              '--cwd',
              getPaths().web.config,
              '--path',
              getPaths().web.components,
              '--yes',
              force && '--overwrite',
              componentName,
            ].filter(Boolean),
            process.env['RWJS_CWD']
              ? {
                  cwd: process.env['RWJS_CWD'],
                }
              : {}
          ).catch((error) => {
            if (error.stdout.includes('--overwrite')) {
              throw new Error(
                'Component already exists. Use --force to overwrite'
              )
            } else {
              throw error
            }
          })
        },
      },
      {
        title: 'Formatting source...',
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
                : {}
            )
          } catch {
            // Ignore errors here. The user will have to fix those manually for now
            // TODO: Print warning message if formatting failed
          }
        },
      },
      {
        title: 'Renaming file(s)...',
        task: async () => {
          // TODO: Read from registry to rename all newly added files

          // TODO: Support JS
          const componentPath = path.join(
            getPaths().web.components,
            'ui',
            componentName + '.tsx'
          )
          const pascalComponentPath = path.join(
            getPaths().web.components,
            'ui',
            pascalcase(componentName) + '.tsx'
          )

          fs.renameSync(componentPath, pascalComponentPath)
        },
      },
    ],
    { rendererOptions: { collapse: false } }
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
