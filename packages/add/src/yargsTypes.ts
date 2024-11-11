export interface BaseOptions {
  _: string[]
  cwd: string | undefined
}

export interface CommandOptions extends BaseOptions {
  components: string[] | undefined
  force: boolean
}
