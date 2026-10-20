import type { Pairing } from '../shared/index.ts'
import { z } from 'zod'
import type { SessionModel } from './model.ts'
import type { DomainAccess } from './storage.ts'

const keyOf = ({ provider, model }: SessionModel): string => JSON.stringify([provider, model])
const modelKey = z.tuple([z.string(), z.string()])

export class Pairings {
  constructor(private readonly storage: DomainAccess) {}

  async get(model: SessionModel): Promise<string | null | undefined> {
    const record = (await this.storage.domain()).table('pairings').get(keyOf(model))
    return record === undefined ? undefined : record.connectionId
  }

  async set(model: SessionModel, connectionId: string | null): Promise<void> {
    await (await this.storage.domain()).table('pairings').put(keyOf(model), { connectionId })
  }

  async list(): Promise<Pairing[]> {
    const table = (await this.storage.domain()).table('pairings')
    return [...table.entries()].map(([key, value]) => {
      const [provider, model] = modelKey.parse(JSON.parse(key))
      return { provider, model, connectionId: value.connectionId }
    })
  }

  async forget(model: SessionModel): Promise<void> {
    await (await this.storage.domain()).table('pairings').delete(keyOf(model))
  }
}
