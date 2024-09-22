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

Under the hood this will run `npx shadcn-ui@0.8.0 add --cwd ./config --path components/ui --yes <component>`

Contributing
------------

If you want to add JS support, or contribute any other changes an easy way to test this locally is:
```
yarn start --cwd ../rw-example-project <component>
```

### Releasing

It's made to be released by npm (e.g. `npm run release:patch`). That way I don't have to worry about yarn v1 vs v3
