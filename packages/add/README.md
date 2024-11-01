rw-shad
=======

Generate components in your RedwoodJS project

Usage
-----

```
yarn rw-shad <component>
```

Details
-------

Under the hood this will run `npx --yes <shadcn-build.tgz> add --config-dir config --path components/ui --no-overwrite <component>`
Where `<shadcn-build.tgz>` is my latest build of `shadcn` and `<component>` is
the name of the component you want to generate.

Contributing
------------

If you want to add JS support, or contribute any other changes an easy way to
test this locally is:
```
yarn start --cwd ../rw-example-project <component>
```

### Releasing

Just run `yarn release:patch|minor|major` in this directory (`packages/add`)
