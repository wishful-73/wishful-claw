/**
 * 服务商列表「推荐」分组的名单。
 *
 * 放这里而不是塞进 provider preset，是因为这是**产品决策**而不是服务商自身的属性：
 * 上下架一个推荐位只动这个文件，不用碰 46 个 preset，也不用防着 preset 重投影把标记冲掉。
 *
 * 角标只写事实（是否免费 / 价格），不写形容词 —— 推荐位一旦有一次不实，
 * 之后所有推荐都不被信。
 */

export type ProviderRecommendationBadge = 'paid' | 'free'

export interface ProviderRecommendation {
  builtinId: string
  badge: ProviderRecommendationBadge
}

/** 顺序即展示顺序。 */
export const RECOMMENDED_PROVIDERS: readonly ProviderRecommendation[] = [
  { builtinId: 'opencode-go', badge: 'paid' },
  { builtinId: 'agnes', badge: 'free' },
  { builtinId: 'sensenova', badge: 'free' }
]
