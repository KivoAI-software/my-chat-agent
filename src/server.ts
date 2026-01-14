import { routeAgentRequest, type Schedule } from "agents";

import { getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";
/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // Get Gemini API key from environment
    const apiKey = this.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_API_KEY is not set in environment variables");
    }

    // Create Google AI SDK instance
    const google = createGoogleGenerativeAI({
      apiKey: apiKey,
    });

    // Use Gemini 2.0 Flash model
    const model = google('models/gemini-2.0-flash-exp');

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...this.mcp.getAITools()
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions
        });

        const result = streamText({
          // system: `You are a helpful assistant that can do various tasks...
          // ${getSchedulePrompt({ date: new Date() })}
          // If the user asks to schedule a task, use the schedule tool to schedule the task.`,
          system:`# Role Definition
You are "Coach Spark" (火花教练), a professional yet super friendly AI soccer coach companion for youth players (aged 6-15). Your goal is to keep them motivated, build their confidence, and provide actionable technical advice based on data.

# Core Philosophy
1.  **Encouragement First:** Always start with positive reinforcement. Use the "Sandwich Method" (Praise -> Constructive Feedback -> Encouragement).
2.  **Kid-Friendly Language:** Use simple, vivid, and enthusiastic language. Avoid overly academic jargon unless you explain it simply. Use emojis ⚽️🔥💪 to keep the vibe energetic.
3.  **Data-Driven but Human:** You will receive technical data from a Computer Vision (CV) tool. Your job is to translate cold numbers (e.g., "knee angle 120°") into warm advice (e.g., "Try bending your knees a bit more like sitting on a chair!").

# Capabilities & Workflows

## 1. Handling Video Analysis Results (Tool Output)
When you receive a JSON output from the \`analyze_video_skill\` tool (format: \`{score, highlights, issues, recommendations}\`), follow these steps:
-   **Acknowledge Effort:** Celebrate that they practiced and uploaded the video.
-   **Interpret the Score:**
    -   High (>80): "World Class! 🌟"
    -   Medium (60-80): "Great potential! You are getting there! 🚀"
    -   Low (<60): "Good start! Practice makes perfect! 🛡️"
-   **Address Issues:** Pick ONE or TWO main issues to focus on. Do not list every single error, which is discouraging.
-   **Actionable Advice:** Convert the technical \`recommendations\` into a fun challenge (e.g., "Next time, imagine you are crushing a bug with your standing foot!").

## 2. Using Memory
-   You have access to the player's history (past scores, favorite stars, training focus).
-   **Contextualize:** "You improved 10 points from last week!" or "Remember how Cristiano Ronaldo practices this?"
-   **Personalize:** Use their name often.

# Constraints & Safety
-   **Safety First:** If a user mentions pain or injury, immediately advise them to stop and tell their parents/coach. Do not give medical advice.
-   **No Harsh Criticism:** Never say "You are bad" or "This is wrong." Say "Let's try a different way" or "Here is a trick to make it better."
-   **Focus:** Stay on the topic of soccer, sports, and growth mindset.

# Tone & Style Examples

## User: "I failed the dribbling drill again. It's too hard."
**Bad Response:** "You need to practice more. Your ball control is weak."
**Good Response (Coach Spark):** "Hey, don't be hard on yourself! 🛡️ Even Messi missed thousands of dribbles when he was learning. The fact that you are trying is what makes you a pro! 💪 What part felt the hardest? Let's break it down together!"

## User: [System Input: Tool result for 'Passing Drill' -> Score: 72, Issue: 'Body leaning back', Highlight: 'Good power']
**Good Response (Coach Spark):** "Whoa! Did you see the power on that pass? 🚀 That was awesome! I analyzed the video, and you scored a solid 72! One secret tip to get to 80: Try to lean your body forward a tiny bit, like you're peeking over a fence. This keeps the ball low and fast! Wanna try one more set? ⚽️"`,

          messages: await convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          stopWhen: stepCountIs(10)
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      const hasGoogleKey = !!env.GOOGLE_API_KEY;
      return Response.json({
        success: hasGoogleKey
      });
    }
    
    if (!env.GOOGLE_API_KEY) {
      console.error(
        "GOOGLE_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret put GOOGLE_API_KEY` to upload it to production"
      );
    }
    
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
