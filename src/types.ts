export type SessionStatus = 'active' | 'waiting' | 'completed' | 'errored' | 'stopped' | 'held';
export type SessionType = 'hook-monitored' | 'sdk-managed';

export interface Session {
  id: string;
  name: string;
  project: string;
  status: SessionStatus;
  sessionType: SessionType;
  permissionMode: string;
  startedAt: Date;
  lastActivity: Date;
  toolCount: number;
  filesModified: Set<string>;
  events: HookEvent[];
  pendingPermission: PendingPermission | null;
  transcriptPath: string | null;
  terminalPid: number | null;
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
  host: string;
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
  sessionType: SessionType;
  startedAt: string;
  lastActivity: string;
  toolCount: number;
  filesModified: string[];
  hasTranscript: boolean;
  pendingPermission: {
    toolName: string;
    toolInput: Record<string, any>;
    toolUseId: string;
    receivedAt: string;
  } | null;
}

export interface TranscriptMessageDTO {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';
  text: string;
  toolName?: string;
  toolId?: string;
  timestamp?: string;
}

export interface FeedEventDTO {
  timestamp: string;
  sessionId: string;
  sessionName: string;
  eventName: string;
  toolName?: string;
  detail?: string;
}
