import {
  Action,
  ObservationData,
  TaskContext,
} from "../../../lib/types/index.js";
import { llmManager } from "../../../console-client/src/llm/index.js";
import { logger } from "../../../lib/observability/logger.js";

export class LLMPlanner {
  async planNextAction(context: {
    instruction: string;
    currentUrl?: string;
    observation: ObservationData;
    stepHistory: Action[];
    attemptNumber?: number;
  }): Promise<Action> {
    const {
      instruction,
      currentUrl,
      observation,
      stepHistory,
      attemptNumber = 1,
    } = context;

    // Build prompt for LLM
    const prompt = this.buildPrompt(
      instruction,
      currentUrl,
      observation,
      stepHistory,
      attemptNumber
    );

    logger.debug("Planning next action", {
      instruction,
      stepNumber: stepHistory.length + 1,
      elementCount: observation.elements.length,
    });

    try {
      const response = await llmManager.generate(prompt, {
        temperature: 0.1,
        maxTokens: 500,
      });

      // Parse LLM response to extract action
      const action = this.parseAction(response.text);

      logger.info("Action planned", {
        type: action.type,
        selector: action.selector,
        llm: response.model,
        cached: response.cached,
      });

      return action;
    } catch (error: any) {
      logger.error("Planning failed", { error: error.message });
      throw new Error(`Failed to plan next action: ${error.message}`);
    }
  }

  private buildPrompt(
    instruction: string,
    currentUrl: string | undefined,
    observation: ObservationData,
    stepHistory: Action[],
    attemptNumber: number
  ): string {
    const parts = [];

    parts.push(
      "You are a web automation agent. Your task is to complete the following instruction:"
    );
    parts.push(`\nInstruction: ${instruction}`);

    if (currentUrl) {
      parts.push(`\nCurrent URL: ${currentUrl}`);
    }

    if (stepHistory.length > 0) {
      parts.push("\nSteps completed so far:");
      stepHistory.slice(-3).forEach((action, i) => {
        parts.push(
          `${i + 1}. ${action.type} ${action.selector || action.url || ""}`
        );
      });
    }

    parts.push("\nPage observation:");
    parts.push(this.formatObservation(observation));

    if (attemptNumber > 1) {
      parts.push(
        `\n(This is attempt #${attemptNumber} - previous attempt failed)`
      );
    }

    parts.push("\nIMPORTANT INSTRUCTIONS FOR LOGIN/AUTHENTICATION:");
    parts.push(
      "- If you need to login to LinkedIn, navigate to https://www.linkedin.com/login"
    );
    parts.push("- Look for email/username and password fields");
    parts.push(
      "- Use ${LINKEDIN_EMAIL} and ${LINKEDIN_PASSWORD} as fill values"
    );
    parts.push(
      "- The system will automatically replace these with actual credentials"
    );
    parts.push(
      "- If 2FA or verification is needed, wait for user intervention"
    );
    parts.push("- For Google authentication, handle it step by step");
    parts.push("- After login, navigate to the user's profile page");
    parts.push("");
    parts.push("EXAMPLE LOGIN SEQUENCE FOR LINKEDIN:");
    parts.push('1. {"type": "navigate", "url": "https://www.linkedin.com/login"}');
    parts.push('2. {"type": "wait", "selector": "#username", "timeout": 5000}');
    parts.push('3. {"type": "fill", "selector": "#username", "value": "${LINKEDIN_EMAIL}"}');
    parts.push('4. {"type": "fill", "selector": "#password", "value": "${LINKEDIN_PASSWORD}"}');
    parts.push('5. {"type": "click", "selector": "button[type=\\"submit\\"]"}');
    parts.push('6. {"type": "wait", "timeout": 3000} // Wait for login to complete');
    parts.push('7. {"type": "navigate", "url": "https://www.linkedin.com/in/me/"}');
    parts.push("");
    parts.push("NOTE: Common LinkedIn selectors:");
    parts.push("- Email input: #username, #session_key, input[name=session_key]");
    parts.push("- Password input: #password, #session_password, input[name=session_password]");
    parts.push("- Submit button: button[type=submit], .sign-in-form__submit-button, .login__form_action_container button");

    parts.push("\nWhat should be the next action? Respond in JSON format:");
    parts.push("IMPORTANT JSON RULES:");
    parts.push("- NO COMMENTS in JSON (no // or /* */ )");
    parts.push("- All property names must be in double quotes");
    parts.push("- NO trailing commas");
    parts.push("- navigate action MUST have url property with full URL");
    parts.push("- click action MUST have selector property");
    parts.push("- fill action MUST have both selector and value");
    parts.push("");
    parts.push("Response format:");
    parts.push("{");
    parts.push('  "type": "navigate|click|fill|wait|screenshot",');
    parts.push('  "selector": "CSS selector (required for click/fill/wait)",');
    parts.push('  "value": "value to fill (required for fill)",');
    parts.push('  "url": "FULL URL like https://... (required for navigate)",');
    parts.push('  "path": "path to save screenshot (optional for screenshot)",');
    parts.push('  "reasoning": "brief explanation"');
    parts.push("}");
    parts.push("");
    parts.push("CORRECT EXAMPLES:");
    parts.push('{"type": "navigate", "url": "https://linkedin.com/login", "reasoning": "Go to login page"}');
    parts.push('{"type": "fill", "selector": "#username", "value": "${LINKEDIN_EMAIL}", "reasoning": "Enter email"}');
    parts.push('{"type": "click", "selector": "button[type=submit]", "reasoning": "Submit form"}');
    parts.push("");
    parts.push("WRONG EXAMPLES (DO NOT DO THIS):");
    parts.push('{"type": "navigate", "selector": "#link"} // WRONG - navigate needs url, not selector');
    parts.push('{"type": "navigate", "url": "linkedin.com"} // WRONG - must start with https://');

    return parts.join("\n");
  }

  private formatObservation(observation: ObservationData): string {
    if (observation.elements.length === 0) {
      return "No interactive elements found on the page.";
    }

    const parts = [];
    parts.push(`Found ${observation.elements.length} interactive elements:`);

    // Group by type
    const byType = observation.elements.reduce(
      (acc, el) => {
        if (!acc[el.type]) acc[el.type] = [];
        acc[el.type].push(el);
        return acc;
      },
      {} as Record<string, typeof observation.elements>
    );

    Object.entries(byType).forEach(([type, elements]) => {
      parts.push(`\n${type}s:`);
      elements.slice(0, 5).forEach((el) => {
        const label = el.label || el.placeholder || "unlabeled";
        parts.push(`  - "${label}" (selector: ${el.selector})`);
      });
      if (elements.length > 5) {
        parts.push(`  ... and ${elements.length - 5} more`);
      }
    });

    return parts.join("\n");
  }

  private parseAction(llmResponse: string): Action {
    try {
      // Try to extract JSON from the response
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in LLM response");
      }

      let jsonString = jsonMatch[0];

      // Remove comments from JSON (common LLM mistake)
      jsonString = this.removeJsonComments(jsonString);

      const parsed = JSON.parse(jsonString);

      // Validate required fields
      if (!parsed.type) {
        throw new Error("Action type is required");
      }

      // Validate action structure
      this.validateAction(parsed);

      const action: Action = {
        type: parsed.type,
      };

      if (parsed.selector) action.selector = parsed.selector;
      if (parsed.value) action.value = parsed.value;
      if (parsed.url) action.url = parsed.url;
      if (parsed.path) action.path = parsed.path;
      if (parsed.timeout) action.timeout = parsed.timeout;

      return action;
    } catch (error: any) {
      logger.error("Failed to parse LLM response", {
        response: llmResponse,
        error: error.message,
      });

      // Fallback: try to extract action from natural language
      return this.fallbackParse(llmResponse);
    }
  }

  private removeJsonComments(jsonString: string): string {
    let result = '';
    let inString = false;
    let inSingleComment = false;
    let inMultiComment = false;
    let escapeNext = false;

    for (let i = 0; i < jsonString.length; i++) {
      const char = jsonString[i];
      const nextChar = jsonString[i + 1];

      // Handle escape sequences inside strings
      if (escapeNext) {
        if (inString) result += char;
        escapeNext = false;
        continue;
      }

      if (char === '\\' && inString) {
        result += char;
        escapeNext = true;
        continue;
      }

      // Toggle string state
      if (char === '"' && !inSingleComment && !inMultiComment) {
        inString = !inString;
        result += char;
        continue;
      }

      // Skip if inside string
      if (inString) {
        result += char;
        continue;
      }

      // Handle multi-line comment start
      if (char === '/' && nextChar === '*' && !inSingleComment && !inMultiComment) {
        inMultiComment = true;
        i++; // Skip next char
        continue;
      }

      // Handle multi-line comment end
      if (char === '*' && nextChar === '/' && inMultiComment) {
        inMultiComment = false;
        i++; // Skip next char
        continue;
      }

      // Handle single-line comment start
      if (char === '/' && nextChar === '/' && !inMultiComment) {
        inSingleComment = true;
        i++; // Skip next char
        continue;
      }

      // Handle single-line comment end
      if (char === '\n' && inSingleComment) {
        inSingleComment = false;
        result += char; // Preserve newline
        continue;
      }

      // Skip characters inside comments
      if (inSingleComment || inMultiComment) {
        continue;
      }

      // Add character if not in comment
      result += char;
    }

    // Remove trailing commas before closing brackets
    result = result.replace(/,(\s*[}\]])/g, '$1');

    return result;
  }

  private validateAction(action: any): void {
    const type = action.type;

    // Validate navigate action
    if (type === 'navigate' && !action.url) {
      throw new Error('navigate action requires url property');
    }

    // Validate click action
    if (type === 'click' && !action.selector) {
      throw new Error('click action requires selector property');
    }

    // Validate fill action
    if (type === 'fill' && (!action.selector || !action.value)) {
      throw new Error('fill action requires both selector and value properties');
    }

    // Validate URL format for navigate
    if (type === 'navigate' && action.url && !action.url.startsWith('http')) {
      logger.warn('navigate url should start with http:// or https://', { url: action.url });
    }
  }

  private fallbackParse(text: string): Action {
    const lower = text.toLowerCase();

    // Simple heuristics
    if (lower.includes("click")) {
      return { type: "click", selector: "button" };
    }

    if (lower.includes("navigate") || lower.includes("go to")) {
      return { type: "navigate", url: "about:blank" };
    }

    if (lower.includes("fill") || lower.includes("type")) {
      return { type: "fill", selector: "input", value: "" };
    }

    if (lower.includes("wait")) {
      return { type: "wait", selector: "*", timeout: 5000 };
    }

    // Default: wait
    return { type: "wait", timeout: 2000 };
  }
}
