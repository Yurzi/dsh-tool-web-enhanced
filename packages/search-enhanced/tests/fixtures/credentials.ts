import { CredentialProvider, type CredentialRef } from '@deepseek-ai/dsh-credentials'

// Public service implementations for the seam; only their outbound network is mocked.
export class MemoryCredentials extends CredentialProvider {
  readonly values = new Map<CredentialRef, string>()
  override async resolve(ref: CredentialRef) {
    const value = this.values.get(ref)
    return value === undefined ? undefined : { value, source: 'memory' }
  }
  override async describe(ref: CredentialRef) { return { configured: this.values.has(ref), writable: true } }
  override async set(ref: CredentialRef, value: string) { this.values.set(ref, value) }
  override async unset(ref: CredentialRef) { this.values.delete(ref) }
  override readRecord(): never { throw new Error('record API not used') }
  override describeRecord(): never { throw new Error('record API not used') }
  override listRecords(): never { throw new Error('record API not used') }
  override modifyRecord(): never { throw new Error('record API not used') }
  override deleteRecord(): never { throw new Error('record API not used') }
}
