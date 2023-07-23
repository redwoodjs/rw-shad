import fs from 'fs'
import path from 'path'

import execa from 'execa'
import findup from 'findup-sync'
import { hideBin, Parser } from 'yargs/helpers'
import yargs from 'yargs'

import { scriptName, description, builder, handler } from './rwgcSetup'

// @ts-ignore
let { cwd, help } = Parser(hideBin(process.argv))
cwd ??= process.env['RWJS_CWD']

try {
  if (cwd) {
    // `cwd` was set by the `--cwd` option or the `RWJS_CWD` env var. In this case,
    // we don't want to find up for a `redwood.toml` file. The `redwood.toml` should just be in that directory.
    if (!fs.existsSync(path.join(cwd, 'redwood.toml')) && !help) {
      throw new Error(`Couldn't find a "redwood.toml" file in ${cwd}`)
    }
  } else {
    // `cwd` wasn't set. Odds are they're in a Redwood project,
    // but they could be in ./api or ./web, so we have to find up to be sure.

    const redwoodTOMLPath = findup('redwood.toml', { cwd: process.cwd() })

    if (!redwoodTOMLPath && !help) {
      throw new Error(
        `Couldn't find up a "redwood.toml" file from ${process.cwd()}`
      )
    }

    if (redwoodTOMLPath) {
      cwd = path.dirname(redwoodTOMLPath)
    }
  }
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message)
  }

  process.exit(1)
}

process.env['RWJS_CWD'] = cwd

// Check yarn version using execa
const { stdout } = execa.sync('yarn', ['--version'], { cwd })
const majorVersion = parseInt(stdout.split('.')[0] || '0', 10)

if (majorVersion < 3) {
  throw new Error(
    `You are using yarn ${stdout}. Please upgrade to yarn 3 or above`
  )
}

yargs
  .scriptName(scriptName)
  .option('cwd', {
    type: 'string',
    demandOption: false,
    description: 'Working directory to use (where `redwood.toml` is located)',
  })
  .command('$0', description, builder, handler)
  .parse()
