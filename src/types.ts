export type SessionStatus = 'active' | 'waiting' | 'completed' | 'errored';

export interface Session {
  id: string;
  name: string;
  project: string;
  status: SessionStatus;
  permissionMode: string;
  startedAt: Date;
  lastActivity: Date;
  toolCount: number;
  filesModified: Set<string>;
  events: HookEvent[];
  pendingPermission: PendingPermission | null;
}

export interface HookEvent {
  timestamp: Date;
  sessionId: string;
  eventName: string;
  toolName?: string;
  toolInput?: Record<string, any>;
  toolUseId?: string;
}

export interface PendingPermission {
  toolName: string;
  toolInput: Record<string, any>;
  toolUseId: string;
  receivedAt: Date;
  resolve: (response: HookResponse) => void;
  timeout: NodeJS.Timeout;
}

export interface HookPayload {
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: Record<string, any>;
  tool_use_id?: string;
}

export interface HookResponse {
  hookSpecificOutput?: {
    hookEventName: string;
    permissionDecision?: 'allow' | 'deny' | 'ask' | 'defer';
    permissionDecisionReason?: string;
    updatedInput?: Record<string, any>;
  };
}

export interface AppConfig {
  port: number;
  permissionTimeoutSeconds: number;
  notifications: {
    enabled: boolean;
    sound: boolean;
  };
  autoPassTools: string[];
  maxEventsPerSession: number;
  maxTotalFeedEvents: number;
  openBrowser: boolean;
}

export interface SessionDTO {
  id: string;
  name: string;
  project: string;
  status: SessionStatus;
  startedAt: string;
  lastActivity: string;
  toolCount: number;
  filesModified: string[];
  pendingPermission: {
    toolName: string;
    toolInput: Record<string, any>;
    toolUseId: string;
    receivedAt: string;
  } | null;
}

export interface FeedEventDTO {
  timestamp: string;
  sessionId: string;
  sessionName: string;
  eventName: string;
  toolName?: string;
  detail?: string;
}
