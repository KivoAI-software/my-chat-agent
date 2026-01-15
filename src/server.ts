import { routeAgentRequest, type Schedule } from "agents";

import { getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "./ai-chat";
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
          system:await this.getPrompt(),

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
    if (url.pathname === "/agents/check-open-ai-key") {
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
    // Handle requests under /agents path for UI and static assets
    if (url.pathname.startsWith('/agents')) {
      // Remove /agents prefix and route to agent
      const modifiedUrl = new URL(request.url);
      modifiedUrl.pathname = url.pathname.replace(/^\/agents/, '') || '/';
      
      const modifiedRequest = new Request(modifiedUrl, request);
      const agentResponse = await routeAgentRequest(modifiedRequest, env);
      
      if (agentResponse) {
        return agentResponse;
      }
    }
    
    // Redirect root to /agents
    if (url.pathname === '/' || url.pathname === '') {
      return Response.redirect(new URL('/agents', url.origin), 302);
    }
    
    return new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
