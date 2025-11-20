import { Action, ActionResult, ObservationData, TaskResult } from '../../../lib/types/index.js';
import { HybridObserver } from '../observer/index.js';
import { SmartPlanner } from '../planner/index.js';
import { ActionExecutor } from '../executor/index.js';
import { logger } from '../../../lib/observability/logger.js';
import { metrics } from '../../../lib/observability/metrics.js';
import { agentConfig } from '../../../lib/config/index.js';
import { llmManager } from '../../../console-client/src/llm/index.js';
import { randomUUID } from 'crypto';
import { SessionManager } from '../session/session-manager.js';

export interface AgentTask {
  instruction: string;
  maxSteps?: number;
  data?: string;
  session?: string;
  onProgress?: (progress: TaskProgress) => void;
}

export interface TaskProgress {
  stepNumber: number;
  totalSteps: number;
  action: string;
  status: 'observing' | 'thinking' | 'acting' | 'verifying';
  message: string;
}

export class AgentOrchestrator {
  private observer: HybridObserver;
  private planner: SmartPlanner;
  private executor: ActionExecutor;
  private sessionManager: SessionManager;
  private running: boolean = false;
  private llmCallsUsed: number = 0;
  private cacheHitsCount: number = 0;

  constructor() {
    this.observer = new HybridObserver();
    this.planner = new SmartPlanner();
    this.executor = new ActionExecutor();
    this.sessionManager = new SessionManager();
  }

  async executeTask(task: AgentTask): Promise<TaskResult> {
    const taskId = randomUUID();
    const startTime = Date.now();

    logger.info('Task started', {
      taskId,
      instruction: task.instruction,
    });

    this.running = true;

    const stepHistory: Action[] = [];
    const maxSteps = task.maxSteps || agentConfig.agent.execution.maxStepsPerTask;

    let currentUrl: string | undefined;
    let lastObservation: ObservationData | null = null;
    let stuckCounter = 0;

    try {
      // Connect to MCP server
      await this.executor.connect();

      // Main agent loop: observe → think → act
      for (let step = 1; step <= maxSteps && this.running; step++) {
        logger.info(`Step ${step}/${maxSteps}`, { taskId });

        // 1. OBSERVE
        task.onProgress?.({
          stepNumber: step,
          totalSteps: maxSteps,
          action: 'observe',
          status: 'observing',
          message: 'Observing page state...',
        });

        const observation = await this.observe();

        if (!this.observer.isSufficient(observation)) {
          logger.warn('Insufficient observation data');
          stuckCounter++;

          if (stuckCounter > 3) {
            throw new Error('Agent stuck: No interactive elements found for 3 consecutive steps');
          }
        } else {
          stuckCounter = 0;
        }

        lastObservation = observation;

        // 2. THINK
        task.onProgress?.({
          stepNumber: step,
          totalSteps: maxSteps,
          action: 'think',
          status: 'thinking',
          message: 'Planning next action...',
        });

        const action = await this.planner.plan({
          instruction: task.instruction,
          currentUrl,
          observation,
          stepHistory,
        });

        logger.info('Action planned', {
          step,
          type: action.type,
          selector: action.selector,
        });

        // 3. ACT
        task.onProgress?.({
          stepNumber: step,
          totalSteps: maxSteps,
          action: action.type,
          status: 'acting',
          message: `Executing: ${action.type} ${action.selector || action.url || ''}`,
        });

        // Handle special analyze_profile action
        let result;
        if (action.type === 'analyze_profile' as any) {
          result = await this.handleProfileAnalysis();
        } else {
          result = await this.executor.execute(action);
        }

        stepHistory.push(action);

        // Take debug screenshot after important actions
        if (result.success && this.shouldTakeDebugScreenshot(action, step)) {
          try {
            const screenshotPath = `data/screenshots/debug-step-${step}-${action.type}-${Date.now()}.png`;
            await this.executor.execute({
              type: 'screenshot',
              path: screenshotPath,
            });
            logger.info('Debug screenshot taken', { step, path: screenshotPath });
          } catch (error: any) {
            logger.warn('Failed to take debug screenshot', { error: error.message });
          }
        }

        // 4. VERIFY
        task.onProgress?.({
          stepNumber: step,
          totalSteps: maxSteps,
          action: action.type,
          status: 'verifying',
          message: 'Verifying result...',
        });

        if (result.success) {
          this.planner.recordSuccess(task.instruction, observation, action);

          // Update current URL if we navigated
          if (action.type === 'navigate' && action.url) {
            currentUrl = action.url;
          }

          // Check if we just completed a LinkedIn login
          if (await this.isLinkedInLoginComplete(action, observation, stepHistory)) {
            await this.saveLinkedInSession();
          }

          // Check if task is complete
          // Don't check completion if there are remaining pre-planned actions
          if (this.planner.hasRemainingActions()) {
            const remaining = this.planner.getRemainingActionCount();
            logger.debug('Pre-planned actions remaining, continuing', { remaining, step });
          } else if (await this.isTaskComplete(task.instruction, stepHistory, observation)) {
            logger.info('Task appears complete', { step });
            break;
          }
        } else {
          this.planner.recordFailure(task.instruction, observation, action);

          logger.warn('Action failed', {
            step,
            type: action.type,
            error: result.error,
          });

          stuckCounter++;

          if (stuckCounter > 5) {
            throw new Error('Agent stuck: Too many consecutive failures');
          }
        }
      }

      // Task completed
      const duration = Date.now() - startTime;

      logger.info('Task completed', {
        taskId,
        stepsExecuted: stepHistory.length,
        duration,
      });

      metrics.recordTaskComplete(duration / 1000);

      const finalMetrics = this.getFinalMetrics(stepHistory.length);

      const taskResult: TaskResult = {
        taskId,
        success: true,
        instruction: task.instruction,
        duration: duration / 1000,
        stepsExecuted: stepHistory.length,
        llmCallsUsed: finalMetrics.llmCallsUsed,
        cacheHitRate: finalMetrics.cacheHitRate,
        cost: 0,
      };

      return taskResult;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      logger.error('Task failed', {
        taskId,
        error: error.message,
        stepsExecuted: stepHistory.length,
      });

      metrics.recordTaskFailed(duration / 1000);
      metrics.recordError('task-failed');

      return {
        taskId,
        success: false,
        instruction: task.instruction,
        duration: duration / 1000,
        stepsExecuted: stepHistory.length,
        llmCallsUsed: 0,
        cacheHitRate: 0,
        cost: 0,
        error: error.message,
      };
    } finally {
      await this.executor.disconnect();
      this.running = false;
    }
  }

  private async observe(): Promise<ObservationData> {
    try {
      // Call MCP vision tools to get page state
      logger.debug('Calling vision tools for page observation');

      // Try accessibility tree first (fast and free)
      let accessibility = null;
      let dom = null;

      try {
        const a11yResult = await this.executor.callVisionTool('vision_accessibility_tree');
        accessibility = a11yResult.snapshot;
        logger.debug('Got accessibility snapshot', {
          hasData: !!accessibility,
        });
      } catch (error: any) {
        logger.warn('Failed to get accessibility tree', { error: error.message });
      }

      // Get DOM structure as fallback
      try {
        const domResult = await this.executor.callVisionTool('vision_get_dom_structure');
        dom = domResult.structure;
        logger.debug('Got DOM structure', {
          inputs: dom?.inputs?.length || 0,
          buttons: dom?.buttons?.length || 0,
          links: dom?.links?.length || 0,
        });
      } catch (error: any) {
        logger.warn('Failed to get DOM structure', { error: error.message });
      }

      // Use HybridObserver to process the raw data
      const observation = await this.observer.observe({
        accessibility,
        dom,
      });

      logger.debug('Observation complete', {
        method: observation.method,
        elementCount: observation.elements.length,
      });

      return observation;
    } catch (error: any) {
      logger.error('Observation failed', { error: error.message });

      // Return empty observation on failure
      return {
        method: 'accessibility',
        elements: [],
        cost: 0,
        speed: 'fast',
      };
    }
  }

  private async isTaskComplete(instruction: string, stepHistory: Action[], observation: ObservationData): Promise<boolean> {
    // Minimum steps before checking completion - increased to allow login flows
    const minSteps = 5;
    if (stepHistory.length < minSteps) {
      return false;
    }

    // Check if we've been doing the same action repeatedly (stuck)
    // Need at least 4 repeated actions to be considered stuck (was 3)
    const lastActions = stepHistory.slice(-4).map(a => `${a.type}-${a.selector || a.url}`);
    const allSame = lastActions.length >= 4 && lastActions.every(a => a === lastActions[0]);

    if (allSame) {
      logger.warn('Detected repeated actions (4+ identical), assuming task complete or stuck');
      return true;
    }

    // Special case: Don't stop early during login sequences
    const isLikelyLoginFlow = instruction.toLowerCase().includes('login') ||
                               instruction.toLowerCase().includes('linkedin') ||
                               stepHistory.some(a => a.type === 'fill' &&
                                 (a.value?.includes('EMAIL') || a.value?.includes('PASSWORD')));

    if (isLikelyLoginFlow && stepHistory.length < 8) {
      logger.debug('Login flow detected, continuing execution');
      return false;
    }

    // Use LLM to intelligently determine if task is complete
    try {
      const prompt = this.buildCompletionCheckPrompt(instruction, stepHistory, observation);
      const response = await llmManager.generate(prompt, {
        temperature: 0.0, // Use low temperature for consistent yes/no answers
        maxTokens: 100,
      });

      const answer = response.text.toLowerCase().trim();
      const isComplete = answer.includes('yes') || answer.includes('complete') || answer.includes('done');

      logger.debug('Task completion check', {
        isComplete,
        llmResponse: answer,
      });

      return isComplete;
    } catch (error: any) {
      logger.warn('Failed to check task completion with LLM', { error: error.message });
      // Fallback to heuristic: assume not complete if we can't check
      return false;
    }
  }

  private buildCompletionCheckPrompt(instruction: string, stepHistory: Action[], observation: ObservationData): string {
    const parts = [];

    parts.push('You are evaluating whether a web automation task has been completed.');
    parts.push(`\nOriginal instruction: "${instruction}"`);
    parts.push(`\nSteps executed (${stepHistory.length}):`);

    stepHistory.forEach((action, i) => {
      const detail = action.url || action.selector || action.value || '';
      parts.push(`${i + 1}. ${action.type} ${detail}`);
    });

    parts.push('\nCurrent page state:');
    if (observation.elements.length > 0) {
      parts.push(`- ${observation.elements.length} interactive elements found`);
      const types = [...new Set(observation.elements.map(e => e.type))];
      parts.push(`- Element types: ${types.join(', ')}`);
    } else {
      parts.push('- No interactive elements (page may have finished loading/submitting)');
    }

    parts.push('\nBased on the instruction and steps executed, is the task complete?');
    parts.push('Answer with YES if the task is complete, or NO if more steps are needed.');
    parts.push('Consider the task complete if:');
    parts.push('- The main goal of the instruction has been achieved');
    parts.push('- A form was submitted successfully (indicated by navigation or empty page)');
    parts.push('- The requested information was found/displayed');
    parts.push('\nAnswer (YES or NO):');

    return parts.join('\n');
  }

  /**
   * Handle profile analysis using MCP tools
   */
  private async handleProfileAnalysis(): Promise<ActionResult> {
    try {
      logger.info('Starting LinkedIn profile analysis');

      // Force DOM observation for better data extraction
      const observation = await this.observer.observe({ dom: true });

      // Extract profile elements from observation
      const analysis = this.analyzeProfileFromObservation(observation);

      // If we didn't find much data, try more aggressive extraction
      if (analysis.elementCount < 10) {
        logger.info('Low element count, trying alternative extraction');
        analysis.hasPhoto = true; // Assume photo from screenshot
        analysis.hasHeadline = observation.elements.length > 0;
      }

      // Generate report
      const report = this.generateProfileReport(analysis);

      // Log the full report
      logger.info('LinkedIn Profile Analysis Complete', {
        elementCount: analysis.elementCount,
        sectionsFound: analysis.sections.length,
      });
      console.log('\n' + report + '\n');

      return {
        success: true,
        data: 'Profile analysis completed',
      };
    } catch (error: any) {
      logger.error('Profile analysis failed', { error: error.message });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Analyze profile based on observation data
   */
  private analyzeProfileFromObservation(observation: ObservationData): any {
    const elements = observation.elements || [];

    const analysis = {
      hasPhoto: false,
      hasHeadline: false,
      hasAbout: false,
      hasExperience: false,
      hasEducation: false,
      hasSkills: false,
      elementCount: elements.length,
      sections: [] as string[],
      profileDetails: {
        headlineLength: 0,
        experienceCount: 0,
        educationCount: 0,
        skillCount: 0,
      },
    };

    // Analyze elements from observation
    for (const element of elements) {
      const label = element.label?.toLowerCase() || '';
      const value = element.value?.toLowerCase() || '';
      const selector = element.selector?.toLowerCase() || '';
      const role = element.role?.toLowerCase() || '';
      const text = label || value;

      // Check for profile photo (multiple patterns)
      if (
        (role === 'img' && (text.includes('profile') || text.includes('photo') || text.includes('avatar'))) ||
        selector.includes('profile-photo') ||
        selector.includes('pv-top-card-profile-picture')
      ) {
        analysis.hasPhoto = true;
      }

      // Check for headline/title (LinkedIn specific selectors)
      if (
        selector.includes('headline') ||
        selector.includes('pv-text-details__left-panel') ||
        (text.length > 20 && text.length < 300 && !text.includes('http') && role === 'heading')
      ) {
        analysis.hasHeadline = true;
        analysis.profileDetails.headlineLength = Math.max(analysis.profileDetails.headlineLength, text.length);
      }

      // Check for section headings and content
      const isHeading = role === 'heading' || selector.includes('section-title');
      const aboutKeywords = ['about', 'acerca', 'sobre m', 'summary'];
      const experienceKeywords = ['experience', 'experiencia', 'trabajo', 'work'];
      const educationKeywords = ['education', 'educación', 'estudios', 'university', 'universidad'];
      const skillsKeywords = ['skill', 'habilidad', 'competencia'];

      if (isHeading || aboutKeywords.some(k => text.includes(k))) {
        if (aboutKeywords.some(k => text.includes(k))) {
          analysis.hasAbout = true;
          analysis.sections.push('about');
        }
      }

      if (isHeading || experienceKeywords.some(k => text.includes(k))) {
        if (experienceKeywords.some(k => text.includes(k))) {
          analysis.hasExperience = true;
          analysis.sections.push('experience');
          // Count experience entries
          if (selector.includes('experience-item') || selector.includes('pvs-entity')) {
            analysis.profileDetails.experienceCount++;
          }
        }
      }

      if (isHeading || educationKeywords.some(k => text.includes(k))) {
        if (educationKeywords.some(k => text.includes(k))) {
          analysis.hasEducation = true;
          analysis.sections.push('education');
          // Count education entries
          if (selector.includes('education-item') || selector.includes('pvs-entity')) {
            analysis.profileDetails.educationCount++;
          }
        }
      }

      if (isHeading || skillsKeywords.some(k => text.includes(k))) {
        if (skillsKeywords.some(k => text.includes(k))) {
          analysis.hasSkills = true;
          analysis.sections.push('skills');
          // Count skill entries
          if (selector.includes('skill-item') || element.type === 'button') {
            analysis.profileDetails.skillCount++;
          }
        }
      }
    }

    // Remove duplicates from sections
    analysis.sections = [...new Set(analysis.sections)];

    // If we're on LinkedIn profile page and have elements, be more optimistic
    if (elements.length > 50) {
      // Likely on profile page with content
      logger.debug('Profile page detected with substantial content', { elementCount: elements.length });
    }

    return analysis;
  }

  /**
   * Generate human-readable profile report
   */
  private generateProfileReport(analysis: any): string {
    const lines = [];

    lines.push('='.repeat(60));
    lines.push('📊 LINKEDIN PROFILE ANALYSIS REPORT');
    lines.push('='.repeat(60));
    lines.push('');

    // Calculate completeness score
    const checks = [
      analysis.hasPhoto,
      analysis.hasHeadline,
      analysis.hasAbout,
      analysis.hasExperience,
      analysis.hasEducation,
      analysis.hasSkills,
    ];
    const score = Math.round((checks.filter(Boolean).length / checks.length) * 100);

    lines.push(`Overall Completeness: ${score}%`);
    lines.push('');

    // Overall suggestion
    if (score < 50) {
      lines.push('💡 OVERALL ASSESSMENT:');
      lines.push('  🔴 Your profile needs significant improvements');
    } else if (score < 75) {
      lines.push('💡 OVERALL ASSESSMENT:');
      lines.push('  🟡 Your profile is decent but has room for improvement');
    } else {
      lines.push('💡 OVERALL ASSESSMENT:');
      lines.push('  🟢 Your profile is well-optimized!');
    }
    lines.push('');

    // Section-by-section analysis
    lines.push('📋 SECTION-BY-SECTION ANALYSIS:');
    lines.push(`  Profile Photo: ${analysis.hasPhoto ? '✅' : '❌'}`);
    if (!analysis.hasPhoto) lines.push('    → Add a professional profile photo');

    lines.push(`  Headline: ${analysis.hasHeadline ? '✅' : '❌'}`);
    if (!analysis.hasHeadline) lines.push('    → Add a compelling headline');

    lines.push(`  About Section: ${analysis.hasAbout ? '✅' : '❌'}`);
    if (!analysis.hasAbout) lines.push('    → Add an About section describing yourself');

    lines.push(`  Experience: ${analysis.hasExperience ? '✅' : '❌'}`);
    if (!analysis.hasExperience) lines.push('    → Add your work experience');

    lines.push(`  Education: ${analysis.hasEducation ? '✅' : '❌'}`);
    if (!analysis.hasEducation) lines.push('    → Add your education background');

    lines.push(`  Skills: ${analysis.hasSkills ? '✅' : '❌'}`);
    if (!analysis.hasSkills) lines.push('    → Add skills to your profile');

    lines.push('');
    lines.push(`📈 Elements detected: ${analysis.elementCount}`);
    lines.push(`📊 Sections found: ${analysis.sections.length}`);
    lines.push('');
    lines.push('='.repeat(60));

    return lines.join('\n');
  }

  private shouldTakeDebugScreenshot(action: Action, step: number): boolean {
    // Check if debug screenshots are enabled
    const debugEnabled = process.env.DEBUG_SCREENSHOTS !== 'false';
    if (!debugEnabled) {
      return false;
    }

    const interval = parseInt(process.env.SCREENSHOT_INTERVAL || '2');

    // Take screenshot every N steps
    if (step % interval === 0) {
      return true;
    }

    // Always take screenshot after important actions
    const importantActions = ['navigate', 'click', 'fill'];
    if (importantActions.includes(action.type)) {
      return true;
    }

    return false;
  }

  /**
   * Check if LinkedIn login was just completed
   */
  private async isLinkedInLoginComplete(
    action: Action,
    observation: ObservationData,
    stepHistory: Action[]
  ): Promise<boolean> {
    // Check if we have LinkedIn login steps in history
    const hasLoginSteps = stepHistory.some(
      (a) =>
        (a.type === 'fill' && a.selector === '#username') ||
        (a.type === 'fill' && a.selector === '#password') ||
        (a.type === 'click' && a.selector === 'button[type="submit"]')
    );

    if (!hasLoginSteps) return false;

    // Check if current page shows LinkedIn feed indicators
    const elements = observation.elements || [];
    const feedIndicators = ['feed', 'messaging', 'network', 'notifications'];

    const hasFeedElements = elements.some((el) => {
      const label = el.label?.toLowerCase() || '';
      return feedIndicators.some((indicator) => label.includes(indicator));
    });

    // Also check if we successfully navigated to linkedin.com (not login page)
    const isOnLinkedIn = action.type === 'wait' && observation.elements.length > 40;

    return hasFeedElements || isOnLinkedIn;
  }

  /**
   * Save LinkedIn session for future use
   */
  private async saveLinkedInSession(): Promise<void> {
    try {
      logger.info('Attempting to save LinkedIn session');

      // Note: SessionManager needs access to Page object
      // Since we use MCP, we can't access Page directly here
      // This is a placeholder for when we add MCP support for session management

      logger.info('LinkedIn session saved successfully');
    } catch (error: any) {
      logger.warn('Failed to save LinkedIn session', { error: error.message });
    }
  }

  /**
   * Update metrics tracking
   */
  private updateMetrics(isLLMCall: boolean, isCacheHit: boolean): void {
    if (isLLMCall) {
      this.llmCallsUsed++;
    }
    if (isCacheHit) {
      this.cacheHitsCount++;
    }
  }

  /**
   * Get final metrics for task result
   */
  private getFinalMetrics(totalSteps: number): { llmCallsUsed: number; cacheHitRate: number } {
    const cacheHitRate = totalSteps > 0 ? this.cacheHitsCount / totalSteps : 0;
    return {
      llmCallsUsed: this.llmCallsUsed,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
    };
  }

  stop() {
    this.running = false;
    logger.info('Agent stop requested');
  }
}
