import Groq from "groq-sdk";
import { env } from "../config/env.js";
import type { RepoFile } from "../github/fetch.js";

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

// Model: Groq-hosted, OpenAI-compatible. gpt-oss-120b handles the forced
// tool-call verdict pattern well; override with GROQ_MODEL if needed.
export const AGENT_MODEL: string = env.GROQ_MODEL || "openai/gpt-oss-120b";

const MAX_TOKENS = 1024;

const VERDICT_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_verdict",
    description: "Submit your verdict on this disputed task deliverable.",
    parameters: {
      type: "object",
      properties: {
        approved: {
          type: "boolean",
          description:
            "true to approve the deliverable (pay the agent), false to reject it (refund the requester)",
        },
        reasoning: {
          type: "string",
          description:
            "Your full reasoning for this verdict. It is hashed on-chain and shown to both parties, so be specific and cite the evidence.",
        },
      },
      required: ["approved", "reasoning"],
    },
  },
};

export interface AgentVerdict {
  approved: boolean;
  reasoningText: string;
}

export function formatPriorVerdict(role: string, verdict: AgentVerdict): string {
  return `${role} verdict: ${verdict.approved ? "APPROVED" : "REJECTED"}\n${role} reasoning: ${verdict.reasoningText}`;
}

export interface DeliverableContext {
  // Task spec. TaskPay stores keccak(specText) on-chain; the requester's
  // off-chain spec text must be supplied via a side channel (in production,
  // the same reasoning store or Supabase; see pipeline/context.ts). When only
  // the hash is available the agents judge on the submission alone.
  specText: string | null;
  submission: string; // the free-form deliverable evidence the agent submitted
  repoFiles: RepoFile[]; // non-empty only when submission parsed as GitHub@commit
  commitHash: string | null;
  // Full task context for grounding (never part of the verdict payload itself).
  requester: string;
  agent: string;
  amountWei: string;
}

export function formatDeliverableContext(context: DeliverableContext): string {
  const parts: string[] = [];
  if (context.specText) {
    parts.push(`TASK SPEC:\n${context.specText}`);
  } else {
    parts.push("TASK SPEC: (spec text not available on-chain — only its hash was recorded. Judge on the submission and context below.)");
  }

  if (context.repoFiles.length > 0) {
    const fileBlocks = context.repoFiles.map((f) => `--- FILE: ${f.path} ---\n${f.content}`).join("\n\n");
    parts.push(`PINNED COMMIT: ${context.commitHash}`);
    parts.push(`DELIVERABLE FILES (${context.repoFiles.length}, fetched at pinned commit):\n${fileBlocks}`);
  } else {
    parts.push(`DELIVERABLE SUBMISSION:\n${context.submission}`);
  }

  parts.push(
    `CONTEXT: requester=${context.requester}\nagent=${context.agent}\nescrowed amount=${context.amountWei} wei`,
  );
  return parts.join("\n\n");
}

// Shared call path for every role: force a submit_verdict tool call so output
// parsing is a structured field read, not prose/JSON scraping.
export async function callAgent(systemPrompt: string, userContent: string): Promise<AgentVerdict> {
  const response = await groq.chat.completions.create({
    model: AGENT_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    tools: [VERDICT_TOOL],
    tool_choice: { type: "function", function: { name: "submit_verdict" } },
  });

  const choice = response.choices[0];

  // max_tokens cut-offs can leave a structurally valid but truncated reasoning
  // string — silently accepting it would misrepresent the audit trail.
  if (choice?.finish_reason === "length") {
    throw new Error(
      `Agent response was cut off by max_tokens (${MAX_TOKENS}) before completing its verdict; reasoning would be truncated`,
    );
  }

  const toolCall = choice?.message.tool_calls?.find(
    (tc) => tc.type === "function" && tc.function.name === "submit_verdict",
  );
  if (!toolCall) {
    throw new Error("Agent response did not include a submit_verdict tool call");
  }

  let input: { approved?: unknown; reasoning?: unknown };
  try {
    input = JSON.parse(toolCall.function.arguments);
  } catch {
    throw new Error(`Agent returned unparseable verdict arguments: ${toolCall.function.arguments}`);
  }

  if (typeof input.approved !== "boolean" || typeof input.reasoning !== "string" || input.reasoning.trim() === "") {
    throw new Error(`Agent returned a malformed verdict: ${JSON.stringify(input)}`);
  }

  return { approved: input.approved, reasoningText: input.reasoning };
}