import { Action } from '../../../lib/types/index.js';
import { logger } from '../../../lib/observability/logger.js';

export interface Intent {
  type:
    | 'linkedin_login'
    | 'linkedin_profile_view'
    | 'linkedin_search_people'
    | 'linkedin_send_message'
    | 'linkedin_post_update'
    | 'unknown';
  confidence: number;
  suggestedActions?: Action[];
}

export class IntentDetector {
  /**
   * Detect the intent from the user's instruction
   */
  detectIntent(instruction: string): Intent {
    const lower = instruction.toLowerCase();

    // LinkedIn login intent
    if (this.isLinkedInLogin(lower)) {
      return {
        type: 'linkedin_login',
        confidence: 0.95,
        suggestedActions: this.getLinkedInLoginActions(),
      };
    }

    // LinkedIn profile view intent
    if (this.isLinkedInProfileView(lower)) {
      return {
        type: 'linkedin_profile_view',
        confidence: 0.9,
        suggestedActions: this.getLinkedInProfileViewActions(),
      };
    }

    // LinkedIn search people intent
    if (this.isLinkedInSearchPeople(lower)) {
      return {
        type: 'linkedin_search_people',
        confidence: 0.88,
        suggestedActions: this.getLinkedInSearchPeopleActions(),
      };
    }

    // LinkedIn send message intent
    if (this.isLinkedInSendMessage(lower)) {
      return {
        type: 'linkedin_send_message',
        confidence: 0.87,
        suggestedActions: this.getLinkedInSendMessageActions(),
      };
    }

    // LinkedIn post update intent
    if (this.isLinkedInPostUpdate(lower)) {
      return {
        type: 'linkedin_post_update',
        confidence: 0.86,
        suggestedActions: this.getLinkedInPostUpdateActions(),
      };
    }

    return {
      type: 'unknown',
      confidence: 0.0,
    };
  }

  private isLinkedInLogin(instruction: string): boolean {
    const loginKeywords = ['login', 'log in', 'sign in', 'signin', 'inicia sesión', 'iniciar sesión'];
    const linkedinKeywords = ['linkedin', 'linked in'];

    const hasLogin = loginKeywords.some(kw => instruction.includes(kw));
    const hasLinkedIn = linkedinKeywords.some(kw => instruction.includes(kw));

    return hasLogin && hasLinkedIn;
  }

  private isLinkedInProfileView(instruction: string): boolean {
    const profileKeywords = ['perfil', 'profile', 'mi perfil', 'my profile'];
    const linkedinKeywords = ['linkedin', 'linked in'];
    const analysisKeywords = ['analiza', 'analyze', 'revisa', 'review', 'optimiza', 'optimize'];

    const hasProfile = profileKeywords.some(kw => instruction.includes(kw));
    const hasLinkedIn = linkedinKeywords.some(kw => instruction.includes(kw));
    const hasAnalysis = analysisKeywords.some(kw => instruction.includes(kw));

    // If mentions profile + linkedin, it's profile view
    // If also mentions analysis, confidence is higher
    return (hasProfile && hasLinkedIn) || (hasLinkedIn && hasAnalysis);
  }

  /**
   * Get pre-planned actions for LinkedIn login
   */
  private getLinkedInLoginActions(): Action[] {
    return [
      {
        type: 'navigate',
        url: 'https://www.linkedin.com/login',
        timeout: 15000, // Increased timeout for page load
      },
      {
        type: 'wait',
        selector: '#username',
        timeout: 12000, // Increased wait for elements
      },
      {
        type: 'fill',
        selector: '#username',
        value: '${LINKEDIN_EMAIL}',
        timeout: 8000, // More time for filling
      },
      {
        type: 'wait',
        timeout: 1000, // Small pause between fills
      },
      {
        type: 'fill',
        selector: '#password',
        value: '${LINKEDIN_PASSWORD}',
        timeout: 8000, // More time for filling
      },
      {
        type: 'wait',
        timeout: 1000, // Small pause before submit
      },
      {
        type: 'click',
        selector: 'button[type="submit"]',
        timeout: 8000, // More time for click
      },
      {
        type: 'wait',
        timeout: 10000, // Wait longer for login to complete (2FA, etc)
      },
    ];
  }

  /**
   * Get pre-planned actions for viewing LinkedIn profile
   */
  private getLinkedInProfileViewActions(): Action[] {
    return [
      // First, ensure we're logged in
      ...this.getLinkedInLoginActions(),
      // Then navigate to profile
      {
        type: 'navigate',
        url: 'https://www.linkedin.com/in/me/',
        timeout: 15000, // Increased timeout
      },
      {
        type: 'wait',
        timeout: 5000, // Wait longer for profile to load
      },
      {
        type: 'screenshot',
        path: 'data/screenshots/linkedin-profile-full.png',
      },
      {
        type: 'wait',
        timeout: 2000, // Pause before analysis
      },
      // Custom analyze action - will be handled by orchestrator
      {
        type: 'analyze_profile' as any,
      } as Action,
    ];
  }

  private isLinkedInSearchPeople(instruction: string): boolean {
    const searchKeywords = ['search', 'find', 'buscar', 'encontrar', 'look for'];
    const peopleKeywords = ['people', 'person', 'contact', 'gente', 'persona', 'conexión'];
    return searchKeywords.some(k => instruction.includes(k)) && peopleKeywords.some(k => instruction.includes(k));
  }

  private isLinkedInSendMessage(instruction: string): boolean {
    const messageKeywords = ['message', 'send message', 'enviar mensaje', 'write', 'escribir'];
    return messageKeywords.some(k => instruction.includes(k));
  }

  private isLinkedInPostUpdate(instruction: string): boolean {
    const postKeywords = ['post', 'publicar', 'share', 'compartir', 'update', 'actualización'];
    return postKeywords.some(k => instruction.includes(k));
  }

  private getLinkedInSearchPeopleActions(): Action[] {
    return [
      ...this.getLinkedInLoginActions().slice(0, 8), // Login first
      { type: 'navigate', url: 'https://www.linkedin.com/search/results/people/', timeout: 10000 },
      { type: 'wait', selector: 'input[placeholder*="Search"]', timeout: 5000 },
    ] as Action[];
  }

  private getLinkedInSendMessageActions(): Action[] {
    return [
      ...this.getLinkedInLoginActions().slice(0, 8), // Login first
      { type: 'navigate', url: 'https://www.linkedin.com/messaging/', timeout: 10000 },
      { type: 'wait', timeout: 3000 },
    ] as Action[];
  }

  private getLinkedInPostUpdateActions(): Action[] {
    return [
      ...this.getLinkedInLoginActions().slice(0, 8), // Login first
      { type: 'wait', timeout: 2000 },
      { type: 'click', selector: 'button[aria-label*="Start a post"]', timeout: 5000 },
      { type: 'wait', timeout: 2000 },
    ] as Action[];
  }

  /**
   * Check if we should use pre-planned actions for this intent
   */
  shouldUsePlan(intent: Intent): boolean {
    // Use pre-planned actions if confidence is high
    return intent.confidence >= 0.85 && intent.suggestedActions !== undefined;
  }

  /**
   * Log detected intent
   */
  logIntent(instruction: string, intent: Intent): void {
    logger.info('Intent detected', {
      instruction,
      intentType: intent.type,
      confidence: intent.confidence,
      hasPlan: !!intent.suggestedActions,
      planSteps: intent.suggestedActions?.length || 0,
    });
  }
}
