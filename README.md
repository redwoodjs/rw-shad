rw-shad Monorepo
================

Welcome to the rw-shad monorepo.

[packges/add](packages/add) is home to the `rw-shad` command line tool. This
tool is used to generate components in your RW project.

[packges/setup](packages/setup) is home to the `setup-rw-shad` command line
tool. This tool is used to setup a new RW project with the `rw-shad` command

Installation
------------

To install the `rw-shad` command line tool, run the following command in your RW project:

```
yarn dlx setup-rw-shad
```

See the [setup-rw-shad README](packages/setup/README.md) for more information.

Releasing
---------

The packages are versioned independently. To release a new version of a package,
go to the package directory and run `yarn release:patch|minor|major`
