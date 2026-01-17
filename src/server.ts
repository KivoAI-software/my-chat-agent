import { routeAgentRequest, type Schedule } from "agents";

import { getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "./ai-chat";
import {
  generateId,
  streamText,
  generateText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
//import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";
import { createWorkersAI } from 'workers-ai-provider';
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
    const workersai = createWorkersAI({ binding: this.env.AI });
    const model = workersai("@cf/meta/llama-3-8b-instruct");

    //const model = workersai("models/gemini-1.5-pro");    
    /*
    const apiKey = this.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_API_KEY is not set in environment variables");
    }
    const google = createGoogleGenerativeAI({
      apiKey: apiKey,
    });
    const model = google('models/gemini-2.0-flash-exp');
    */
    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...this.mcp.getAITools()
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Auto-summarization logic
        // Rule: If total messages >= 30, keep recent 20, summarize the oldest batch (e.g. 10), and delete them from raw storage.
        const KEEP_RECENT = 8;
        const SUMMARY_BATCH_SIZE = 4;
        
        // Loop in case we have a huge backlog (e.g. 50 messages -> summarize 30)
        // Check if we have enough messages to trigger a summary (at least KEEP_RECENT + SUMMARY_BATCH_SIZE)
        while (this.messages.length >= KEEP_RECENT + SUMMARY_BATCH_SIZE) {
            const oldestMessages = this.messages.slice(0, SUMMARY_BATCH_SIZE);
            const idsToDelete = oldestMessages.map(m => m.id);
            
            try {
              // Generate summary
              const modelMessages = await convertToModelMessages(oldestMessages);
              const { text } = await generateText({
                model, 
                // prompt to summarize the conversation chunk
                system: "You are an expert summarizer. Summarize the following conversation segment concisely, preserving key facts, user preferences, and decisions. This summary will be stored in long-term memory to maintain context.",
                messages: modelMessages
              });
              
              if (text) {
                // Save to long-term memory
                await this.addMemory(`[Archived Conversation]: ${text}`);
                
                // Delete the raw messages from DB
                await this.deleteMessages(idsToDelete);
                
                // Update local inputs so the current inference only sees the remaining
                this.messages = this.messages.slice(SUMMARY_BATCH_SIZE);
              } else {
                break; // Safety break if generation fails
              }
            } catch (err) {
              console.error("Auto-summarization failed", err);
              break;
            }
        }

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
          stopWhen: stepCountIs(150)
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
    
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
