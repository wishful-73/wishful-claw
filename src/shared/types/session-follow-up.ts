export type SessionFollowUpStatus =
  | 'waiting'
  | 'triggered'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface SessionFollowUpRow {
  id: string
  todo_id: string
  source_session_id: string
  target_session_id: string
  follow_up_at: number
  status: SessionFollowUpStatus
  query_instruction: string
  last_query_result?: string | null
  attempt_count: number
  claim_token?: string | null
  claimed_at?: number | null
  plugin_id?: string | null
  plugin_type?: string | null
  plugin_chat_id?: string | null
  notification_key: string
  desktop_notified_at?: number | null
  channel_notified_at?: number | null
  completed_at?: number | null
  cancelled_at?: number | null
  last_error?: string | null
  created_at: number
  updated_at: number
}

export interface SessionFollowUpRequest {
  id: string
  todoId: string
  sourceSessionId: string
  targetSessionId: string
  followUpAt: number
  queryInstruction: string
  notificationKey?: string
  pluginId?: string
  pluginType?: string
  pluginChatId?: string
}

export interface SessionFollowUpMutationResult {
  success: boolean
  changed: number
  followUp?: SessionFollowUpRow | null
  error?: string | null
}

export interface SessionFollowUpFiredEvent {
  followUp: SessionFollowUpRow
  claimToken: string
}
