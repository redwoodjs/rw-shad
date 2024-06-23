// https://prettier.io/docs/en/options.html
/** @type {import('prettier').Options} */
const config = {
  bracketSpacing: true,
  tabWidth: 2,
  semi: false,
  singleQuote: true,
}

// Need a separate object (`config` in this case) to work around this issue:
// https://github.com/microsoft/TypeScript/issues/47107
module.exports = config
