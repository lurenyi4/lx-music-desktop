/** A successful provider response whose payload cannot be interpreted by the SDK. */
export class MusicSdkResponseError extends Error {
  constructor() {
    super('Invalid music provider response')
    this.name = 'MusicSdkResponseError'
  }
}
