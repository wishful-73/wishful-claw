export interface GoalConfirmModelConfig {
  providerId: string
  providerType: string
  model: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
  thinkingEnabled?: boolean
  thinkingConfig?: Record<string, unknown>
  reasoningEffort?: string
  requestTimeoutSeconds?: number
  requestMaxRetries?: number
}

export interface GoalConfirmResponse {
  confirmed: boolean
  modelConfig?: GoalConfirmModelConfig
}

export class GoalConfirmResolvers {
  private readonly resolvers = new Map<string, (payload: GoalConfirmResponse) => void>()

  register(goalId: string, resolve: (payload: GoalConfirmResponse) => void): void {
    const previous = this.resolvers.get(goalId)
    if (previous) previous({ confirmed: false })
    this.resolvers.set(goalId, resolve)
  }

  resolve(goalId: string, confirmed: boolean, modelConfig?: GoalConfirmResponse['modelConfig']): boolean {
    const resolve = this.resolvers.get(goalId)
    if (!resolve) return false
    resolve({ confirmed, modelConfig })
    this.resolvers.delete(goalId)
    return true
  }

  has(goalId: string): boolean {
    return this.resolvers.has(goalId)
  }
}
