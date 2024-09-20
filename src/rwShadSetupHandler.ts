import fs from 'fs'
import path from 'path'

import execa from 'execa'
import stringify from 'json-stable-stringify'
import { Listr } from 'listr2'
import type { Config as TailwindConfig } from 'tailwindcss'

import {
  colors,
  getPaths,
  writeFile,
  isTypeScriptProject,
} from '@redwoodjs/cli-helpers'

interface ErrorWithExitCode extends Error {
  exitCode?: number
}

function isErrorWithExitCode(e: unknown): e is ErrorWithExitCode {
  return typeof (e as ErrorWithExitCode)?.exitCode !== 'undefined'
}

const defaultTailwindConfig: TailwindConfig = {
  content: ['src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
}

function isDefaultTailwindConfig(config: TailwindConfig) {
  return (
    Object.keys(config).length === Object.keys(defaultTailwindConfig).length &&
    // Compare content array
    Array.isArray(config.content) &&
    config.content.length ===
      Object.keys(defaultTailwindConfig.content).length &&
    // Compare theme object
    !!config.theme?.extend === !!defaultTailwindConfig.theme?.extend &&
    Object.keys(config.theme?.extend || {}).length ===
      Object.keys(defaultTailwindConfig.theme?.extend || {}).length &&
    // Compare plugins array
    !!config.plugins === !!defaultTailwindConfig.plugins &&
    (config.plugins || []).length ===
      Object.keys(defaultTailwindConfig.plugins || []).length
  )
}

function hasConflictingTheme(config: TailwindConfig) {
  if (!config.theme) {
    return false
  }

  if (
    config.theme.container &&
    Object.keys(config.theme.container).length > 0
  ) {
    return true
  }

  if (
    config.theme.extend &&
    Object.keys(config.theme.extend).length > 0 &&
    (config.theme.extend.colors ||
      config.theme.extend.borderRadius ||
      config.theme.extend.fontFamily ||
      config.theme.extend.keyframes ||
      config.theme.extend.animation)
  ) {
    return true
  }

  return (
    config.theme?.extend &&
    Object.keys(config.theme.extend).some((key) => key !== 'colors')
  )
}

function hasConflictingDarkModeSetting(config: TailwindConfig) {
  return config.darkMode && config.darkMode !== 'class'
}

function hasConflictingContentSetting(config: TailwindConfig) {
  return (
    config.content &&
    (!Array.isArray(config.content) ||
      config.content.some((item) => typeof item !== 'string'))
  )
}

export const handler = async ({ force }: { force: boolean }) => {
  const twConfigPath = path.join(getPaths().web.config, 'tailwind.config.js')

  const tasks = new Listr(
    [
      {
        title: 'Check for Tailwind setup...',
        task: () => {
          if (!fs.existsSync(twConfigPath)) {
            throw new Error(
              'Tailwind has not been set up yet.\n' +
                'Please run `yarn rw setup ui tailwind` first.'
            )
          }
        },
      },
      {
        title: 'Installing packages...',
        task: async () => {
          await execa.command(
            'yarn add rw-shad',
            process.env['RWJS_CWD']
              ? {
                  cwd: process.env['RWJS_CWD'],
                }
              : {}
          )

          await execa.command(
            'yarn workspace web add tailwindcss-animate class-variance-authority clsx tailwind-merge lucide-react',
            process.env['RWJS_CWD']
              ? {
                  cwd: process.env['RWJS_CWD'],
                }
              : {}
          )
        },
      },
      {
        title: 'Update tailwind config...',
        task: async (_ctx, task) => {
          const tailwindConfig = await import(twConfigPath)

          if (!force && !tailwindConfig?.default) {
            throw new Error('Could not find default export in tailwind config')
          }

          const twConfig = force
            ? defaultTailwindConfig
            : (tailwindConfig.default as TailwindConfig)

          if (!isDefaultTailwindConfig(twConfig)) {
            if (
              hasConflictingTheme(twConfig) ||
              hasConflictingDarkModeSetting(twConfig) ||
              hasConflictingContentSetting(twConfig)
            ) {
              throw new Error(
                "Can't merge rw-shad Tailwind config with your existing " +
                  'Tailwind config.\n  Use --force to overwrite your ' +
                  'config'
              )
            }

            task.output = colors.warning(
              'Your Tailwind config already had customizations. ' +
                "We've done our best to merge the rw-shad settings with " +
                'yours\n' +
                "If things don't work as expected we recommend you " +
                'rerun the setup with --force to overwrite your config'
            )
          }

          twConfig.darkMode = 'class'

          if (!Array.isArray(twConfig.content)) {
            twConfig.content = ['src/**/*.{js,jsx,ts,tsx}']
          } else {
            twConfig.content.push('src/**/*.{js,jsx,ts,tsx}')
            twConfig.content = Array.from(new Set(twConfig.content))
          }

          twConfig.theme ||= {}
          twConfig.theme.container = {
            center: true,
            padding: '2rem',
            screens: {
              '2xl': '1440px',
            },
          }

          twConfig.theme.extend ||= {}

          twConfig.theme.extend.colors = {
            border: 'hsl(var(--border))',
            input: 'hsl(var(--input))',
            ring: 'hsl(var(--ring))',
            background: 'hsl(var(--background))',
            foreground: 'hsl(var(--foreground))',
            primary: {
              DEFAULT: 'hsl(var(--primary))',
              foreground: 'hsl(var(--primary-foreground))',
            },
            secondary: {
              DEFAULT: 'hsl(var(--secondary))',
              foreground: 'hsl(var(--secondary-foreground))',
            },
            destructive: {
              DEFAULT: 'hsl(var(--destructive))',
              foreground: 'hsl(var(--destructive-foreground))',
            },
            muted: {
              DEFAULT: 'hsl(var(--muted))',
              foreground: 'hsl(var(--muted-foreground))',
            },
            accent: {
              DEFAULT: 'hsl(var(--accent))',
              foreground: 'hsl(var(--accent-foreground))',
            },
            popover: {
              DEFAULT: 'hsl(var(--popover))',
              foreground: 'hsl(var(--popover-foreground))',
            },
            card: {
              DEFAULT: 'hsl(var(--card))',
              foreground: 'hsl(var(--card-foreground))',
            },
          }

          twConfig.theme.extend.borderRadius = {
            lg: `var(--radius)`,
            md: `calc(var(--radius) - 2px)`,
            sm: 'calc(var(--radius) - 4px)',
          }

          twConfig.theme.extend.fontFamily = {
            // Will have to do a text-replace on this later, because it'll come
            // from an import in the generated file
            sans: ['%FONT_FAMILY_SANS%'],
          }

          twConfig.theme.extend.keyframes = {
            'accordion-down': {
              from: { height: '0' },
              to: { height: 'var(--radix-accordion-content-height)' },
            },
            'accordion-up': {
              from: { height: 'var(--radix-accordion-content-height)' },
              to: { height: '0' },
            },
          }

          twConfig.theme.extend.animation = {
            'accordion-down': 'accordion-down 0.2s ease-out',
            'accordion-up': 'accordion-up 0.2s ease-out',
          }

          // TODO: Figure out how to keep existing plugins
          // twConfig.plugins ||= []
          // twConfig.plugins.push("require('tailwindcss-animate')")
          // @ts-expect-error - We'll do a text-replace on this later
          twConfig.plugins = ['%REQUIRE_TW_ANIMATE%']

          // TODO: Need to copy over imports from the existing config
          let twConfigStr =
            "const { fontFamily } = require('tailwindcss/defaultTheme')\n\n" +
            "/** @type {import('tailwindcss').Config} */\n" +
            'module.exports = ' +
            stringify(twConfig, { space: 2 })

          twConfigStr = twConfigStr.replace(
            '"%FONT_FAMILY_SANS%"',
            '...fontFamily.sans'
          )

          twConfigStr = twConfigStr.replace(
            '"%REQUIRE_TW_ANIMATE%"',
            "require('tailwindcss-animate')"
          )

          writeFile(twConfigPath, twConfigStr, { existingFiles: 'OVERWRITE' })

          await execa.command(
            'yarn rw lint --fix web/config/tailwind.config.js',
            process.env['RWJS_CWD']
              ? {
                  cwd: process.env['RWJS_CWD'],
                }
              : {}
          )
        },
        rendererOptions: {
          outputBar: Infinity,
          persistentOutput: true,
        },
      },
      {
        title: 'Update index.css...',
        task: async (_ctx, task) => {
          /**
           * Appends css variables and some base styles to index.css
           */
          const indexCssPath = path.join(getPaths().web.src, 'index.css')
          const indexCss = fs.readFileSync(indexCssPath, 'utf-8')

          if (indexCss.includes('@layer base {')) {
            task.output = colors.warning(
              'index.css already contains base styles. Please double check ' +
                'the updated index.css file for any conflicts'
            )
          }

          const indexCssTemplatePath = path.resolve(
            __dirname,
            '..',
            'templates',
            'index.css.template'
          )
          writeFile(
            indexCssPath,
            indexCss + fs.readFileSync(indexCssTemplatePath, 'utf-8'),
            { existingFiles: 'OVERWRITE' }
          )
        },
        options: {
          persistentOutput: true,
        },
      },
      {
        title: 'Adding cn util...',
        task: () => {
          /**
           * Create web/src/utils/cn.ts
           * Throw an error if it already exists
           */

          const cnUtilPath = path.join(getPaths().web.src, 'utils', 'cn.ts')

          if (!force && fs.existsSync(cnUtilPath)) {
            throw new Error(
              'utils/cn.ts already exists.\nUse --force to override existing config.'
            )
          }

          const cnUtilTemplatePath = path.resolve(
            __dirname,
            '..',
            'templates',
            'cn.ts.template'
          )
          writeFile(cnUtilPath, fs.readFileSync(cnUtilTemplatePath, 'utf-8'), {
            existingFiles: 'OVERWRITE',
          })
        },
      },
      {
        title: 'Adding components config...',
        task: () => {
          /**
           * Create web/config/components.json
           * Throw an error if it already exists
           */

          const componentsConfigPath = path.join(
            getPaths().web.config,
            'components.json'
          )
          if (!force && fs.existsSync(componentsConfigPath)) {
            throw new Error(
              'Components config already exists.\nUse --force to override existing config.'
            )
          }

          const componentsConfigTemplatePath = path.resolve(
            __dirname,
            '..',
            'templates',
            'components.json.template'
          )

          let componentsConfig = fs.readFileSync(
            componentsConfigTemplatePath,
            'utf-8'
          )

          if (!isTypeScriptProject()) {
            componentsConfig = componentsConfig.replace(
              '"tsx": true',
              '"tsx": false'
            )
          }

          writeFile(
            componentsConfigPath,
            fs.readFileSync(componentsConfigTemplatePath, 'utf-8'),
            { existingFiles: 'OVERWRITE' }
          )
        },
      },
    ],
    { rendererOptions: { collapse: false } }
  )

  try {
    await tasks.run()

    // TODO: Link to GH issues/PRs
    console.log()
    console.log(
      colors.green('Send me a DM or @ me on Twitter with any feedback')
    )
    console.log(colors.green('https://twitter.com/tobbedotdev'))
    console.log()
    console.log(
      colors.info('Now try `yarn rw-shad button` to generate your first component')
    )
    console.log()
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
