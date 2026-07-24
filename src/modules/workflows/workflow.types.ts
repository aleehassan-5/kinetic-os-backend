export type TriggerNodeType = "trigger";
export type ConditionNodeType = "condition";
export type ActionNodeType = "action";

export interface WorkflowTriggerData {
  event: "new_lead" | "intent_threshold" | "keyword_match" | "message_received";
  channel?: "WHATSAPP" | "TELEGRAM" | "INSTAGRAM" | "MESSENGER" | "EMAIL" | "ANY";
  threshold?: number; // for intent_threshold
  keywords?: string[]; // for keyword_match
}

export interface WorkflowConditionData {
  field: "intentScore" | "channel" | "status";
  operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
  value: string | number;
}

export interface WorkflowActionData {
  actionType: "ai_reply" | "crm_sync" | "calendar_book" | "notify";
  template?: string; // for ai_reply / notify
  integration?: "HUBSPOT" | "GOOGLE_SHEETS"; // for crm_sync
  provider?: "CALENDLY" | "GOOGLE_CALENDAR"; // for calendar_book
  timeoutSeconds?: number;
}

export interface WorkflowNode {
  id: string;
  type: TriggerNodeType | ConditionNodeType | ActionNodeType;
  data: WorkflowTriggerData | WorkflowConditionData | WorkflowActionData;
}

export interface WorkflowEdge {
  source: string;
  target: string;
  /** Which branch of a condition node this edge follows ("true"/"false"); undefined for non-branching edges. */
  branch?: "true" | "false";
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowExecutionContext {
  workspaceId: string;
  leadId: string;
  event: WorkflowTriggerData["event"];
  eventPayload: Record<string, unknown>;
}

export interface WorkflowLogEntry {
  nodeId: string;
  nodeType: string;
  status: "success" | "skipped" | "failed";
  message: string;
  timestamp: string;
}
