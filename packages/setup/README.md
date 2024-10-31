setup-rw-shad
=============

Command for setting up [rw-shad](https://github.com/Tobbe/rw-shad) in a RedwoodJS project

Setup
-----

```
yarn dlx setup-rw-shad
```

Run the command above inside your Redwood project and it'll setup [rw-shad](https://github.com/Tobbe/rw-shad/packages/add) for you.
You'll get a tailor-made setup of [shadcn/ui](https://ui.shadcn.com) for Redwood, with a Redwood specific cli to generate components.

Usage
-----

Inside your Redwood project you can now use the `rw-shad` command to generate components.

For example, the command below will generate a button component

```
yarn rw-shad button
```

Note
----

Currently this doesn't work great if you've already installed custom Tailwind plugins. It won't know how to update your TW config. PRs are welcome 😉

Contributing
------------

If you want to improve TW config merging, or contribute any other changes an easy way to test this locally is:
```
yarn start --cwd ../rw-example-project --force
```

### Releasing

Just run `yarn release:patch|minor|major` in this directory (`packages/setup`)
