setup-rwgc
==========

Command for setting up [rwgc](https://github.com/Tobbe/rwgc) in a RedwoodJS project

Setup
-----

```
yarn dlx setup-rwgc
```

Run the command above inside your Redwood project and it'll setup [rwgc](https://github.com/Tobbe/rwgc) for you.
You'll get a tailor-made setup of [shadcn/ui](https://ui.shadcn.com) for Redwood, with a RW specific cli to generate components.

Usage
-----

Inside your Redwood project you can now use the `rwgc` command to generate components.

For example, the command below will generate a button component

```
yarn rwgc button
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

It's made to be released by npm (e.g. `npm run release:patch`). That way I don't have to worry about yarn v1 vs v3
