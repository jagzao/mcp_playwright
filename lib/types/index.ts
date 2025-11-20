// Core types for the MCP Playwright Automation system

export interface LLMConfig {
  name: string;
  type: "local" | "ollama" | "openai";
  priority: number;
  model: string;
  endpoint: string;
  cost: number;
  speed: "fast" | "medium" | "slow";
  schedule:
    | string
    | { daytime?: boolean; allowed?: Array<{ start: string; end: string }> };
  resourceLimits?: {
    maxCpuPercent: number;
    maxRamGB: number;
  };
}

export interface TaskContext {
  taskId: string;
  instruction: string;
  url?: string;
  data?: string;
  session?: string;
  timestamp: number;
  currentStep: number;
  maxSteps: number;
  elements?: any[];
  duration?: number;
}

export interface Action {
  type:
    | "navigate"
    | "click"
    | "fill"
    | "select"
    | "scroll"
    | "wait"
    | "screenshot"
    | "download";
  selector?: string;
  value?: any;
  url?: string;
  path?: string;
  timeout?: number;
  expectedTag?: string;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  element?: any;
  visible?: boolean;
  duration?: number;
  data?: any;
}

export interface ObservationData {
  method: "accessibility" | "dom" | "ocr" | "llava" | "hybrid";
  elements: InteractiveElement[];
  structure?: any;
  text?: string;
  screenshot?: Buffer;
  cost: number;
  speed: "fast" | "medium" | "slow";
}

export interface InteractiveElement {
  type: string;
  selector: string;
  label?: string;
  value?: string;
  placeholder?: string;
  role?: string;
}

export interface AgentContext {
  taskId: string;
  instruction: string;
  llm: string;
  lastActionFailed: boolean;
  isStuck: boolean;
  stepHistory: Action[];
  observationHistory: ObservationData[];
}

export interface RetryConfig {
  maxAttempts?: number;
  backoffStrategy?: "exponential" | "linear" | "fibonacci";
  retryableErrors?: string[];
  onRetry?: (attempt: number, error: Error) => void;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
}

export interface SessionData {
  cookies: any[];
  localStorage?: string;
  timestamp: number;
}

export interface Metrics {
  tasksCompleted: number;
  tasksFailed: number;
  llmCalls: number;
  cacheHits: number;
  cacheMisses: number;
  avgTaskDuration: number;
  errorsByType: Map<string, number>;
  actionsByType: Map<string, number>;
}

export interface LearnedPattern {
  signature: string;
  successCount: number;
  failureCount: number;
  avgDuration: number;
  actions: Action[];
  reliable?: boolean;
}

export interface NotificationEvent {
  type: string;
  title: string;
  message: string;
  duration?: number;
  cost?: number;
  payload?: any;
}

export interface Webhook {
  event: string;
  url: string;
  secret: string;
}

export interface Plugin {
  name: string;
  version: string;
  onLoad?(): Promise<void>;
  onUnload?(): Promise<void>;
  tools?: any[];
  observers?: any[];
  llmProviders?: any[];
  beforeAction?(context: ActionContext): Promise<void>;
  afterAction?(context: ActionContext, result: any): Promise<void>;
  onError?(error: Error, context: ActionContext): Promise<void>;
}

export interface ActionContext {
  taskId: string;
  instruction: string;
  action: Action;
  stepNumber: number;
  important?: boolean;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  instruction: string;
  duration: number;
  stepsExecuted: number;
  llmCallsUsed: number;
  cacheHitRate: number;
  cost: number;
  error?: string;
  videoPath?: string;
  screenshotsPath?: string;
  recordingPath?: string;
}
