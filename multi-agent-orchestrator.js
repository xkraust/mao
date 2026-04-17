/**
 * Multi-Agent Orchestrator Pattern — Node.js Example
 * Uses the Anthropic SDK (claude-sonnet-4-20250514)
 *
 * Architecture:
 *   User Request
 *       │
 *   Orchestrator Agent   ← decides which experts to call & synthesizes results
 *       ├── Research Expert    ← explains concepts, answers factual questions
 *       ├── Code Expert        ← writes and explains code
 *       └── Math Expert        ← solves calculations and math problems
 *
 * Install: npm install @anthropic-ai/sdk
 * Run:     ANTHROPIC_API_KEY=your_key node multi-agent-orchestrator.js
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPERT AGENTS
// Each expert has a focused system prompt and handles one class of task.
// ─────────────────────────────────────────────────────────────────────────────

const experts = {
  research: {
    name: "Research Expert",
    systemPrompt: `You are a research expert. You explain concepts clearly and concisely.
Give factual, well-structured answers. Keep responses focused and under 200 words.`,
  },

  code: {
    name: "Code Expert",
    systemPrompt: `You are a senior software engineer. You write clean, commented code.
Always specify the language. Keep examples minimal but complete. Under 200 words.`,
  },

  math: {
    name: "Math Expert",
    systemPrompt: `You are a math expert. You solve problems step-by-step.
Show your reasoning clearly. Give the final answer prominently. Under 150 words.`,
  },
};

/**
 * Calls a single expert agent with a specific task.
 */
async function callExpert(expertKey, task) {
  const expert = experts[expertKey];
  if (!expert) throw new Error(`Unknown expert: ${expertKey}`);

  console.log(`\n  🔧 [${expert.name}] Working on: "${task}"`);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    system: expert.systemPrompt,
    messages: [{ role: "user", content: task }],
  });

  const result = response.content[0].text;
  console.log(`  ✅ [${expert.name}] Done.`);
  return { expert: expert.name, task, result };
}

// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR
// Uses tool_use to decide which experts to call, then synthesizes the results.
// ─────────────────────────────────────────────────────────────────────────────

const orchestratorTools = [
  {
    name: "delegate_to_expert",
    description:
      "Delegate a subtask to a specialized expert agent. " +
      "Call this once per subtask. You may call multiple experts in parallel.",
    input_schema: {
      type: "object",
      properties: {
        expert: {
          type: "string",
          enum: ["research", "code", "math"],
          description:
            "Which expert to use: 'research' for facts/concepts, " +
            "'code' for programming, 'math' for calculations.",
        },
        task: {
          type: "string",
          description: "The specific question or task for this expert.",
        },
      },
      required: ["expert", "task"],
    },
  },
];

/**
 * Orchestrator: receives the user request, decides which experts to use,
 * calls them (in parallel where possible), and synthesizes a final answer.
 */
async function orchestrate(userRequest) {
  console.log(`\n🎯 Orchestrator received: "${userRequest}"`);
  console.log("─".repeat(60));

  // ── Step 1: Ask the orchestrator to decompose the task ──────────────────
  const planResponse = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `You are an orchestrator that coordinates specialist agents.
Your job is to:
1. Analyse the user's request.
2. Break it into subtasks, each suited to one expert (research / code / math).
3. Call delegate_to_expert for EVERY subtask — call the tool multiple times if needed.
4. Do NOT answer anything yourself yet — only delegate via the tool.`,
    messages: [{ role: "user", content: userRequest }],
    tools: orchestratorTools,
    tool_choice: { type: "auto" },
  });

  // ── Step 2: Collect all tool_use blocks ────────────────────────────────
  const delegations = planResponse.content.filter(
    (block) => block.type === "tool_use"
  );

  if (delegations.length === 0) {
    // Orchestrator decided it can answer directly (simple request)
    const directAnswer = planResponse.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    console.log("\n📝 Orchestrator answered directly:\n", directAnswer);
    return directAnswer;
  }

  console.log(`\n📋 Orchestrator planned ${delegations.length} subtask(s).`);

  // ── Step 3: Execute all expert calls in parallel ───────────────────────
  const expertResults = await Promise.all(
    delegations.map((d) => callExpert(d.input.expert, d.input.task))
  );

  // ── Step 4: Build tool_result blocks to send back ──────────────────────
  const toolResults = delegations.map((d, i) => ({
    type: "tool_result",
    tool_use_id: d.id,
    content: expertResults[i].result,
  }));

  // ── Step 5: Ask orchestrator to synthesize all results ─────────────────
  console.log("\n🔄 Synthesizing expert results...");
  const finalResponse = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `You are an orchestrator. The specialist agents have completed their tasks.
Synthesize their outputs into a single, coherent, well-structured answer for the user.
Attribute answers to the right experts where helpful. Be concise.`,
    messages: [
      { role: "user", content: userRequest },
      { role: "assistant", content: planResponse.content },
      { role: "user", content: toolResults },
    ],
    tools: orchestratorTools,
  });

  const finalAnswer = finalResponse.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return finalAnswer;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEMO
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const requests = [
    // Requires research + code experts
    "Explain what a binary search tree is, and show me a simple Node.js implementation.",

    // Requires math + research experts
    "What is the Big-O complexity of merge sort, and calculate how many operations it takes for n=1024?",

    // Requires all three
    "Explain recursion, write a recursive Fibonacci function in JavaScript, and calculate fib(10).",
  ];

  for (const request of requests) {
    console.log("\n" + "═".repeat(60));
    const answer = await orchestrate(request);
    console.log("\n📌 FINAL ANSWER:\n");
    console.log(answer);
    console.log("\n" + "═".repeat(60));
  }
}

main().catch(console.error);
