import { z } from "zod";

const nodeSchema = z.object({
  id: z.string(),
  type: z.enum(["trigger", "condition", "action"]),
  data: z.record(z.any()),
});

const edgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  branch: z.enum(["true", "false"]).optional(),
});

export const graphSchema = z.object({
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(2).max(120),
  graph: graphSchema,
});

export const updateWorkflowSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  graph: graphSchema.optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED"]).optional(),
});
