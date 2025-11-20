import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMPlanner } from '../../agent/src/planner/llm-planner.js';
import { ObservationData, Action } from '../../lib/types/index.js';

describe('LLMPlanner', () => {
  let planner: LLMPlanner;

  beforeEach(() => {
    planner = new LLMPlanner();
  });

  describe('parseAction', () => {
    it('should parse valid JSON action', () => {
      const llmResponse = `{
        "type": "navigate",
        "url": "https://linkedin.com",
        "reasoning": "Need to go to LinkedIn"
      }`;

      const action = (planner as any).parseAction(llmResponse);

      expect(action.type).toBe('navigate');
      expect(action.url).toBe('https://linkedin.com');
    });

    it('should handle JSON wrapped in text', () => {
      const llmResponse = `
        Here is the action:
        {
          "type": "click",
          "selector": "#submit-button",
          "reasoning": "Click the submit button"
        }
        This should work.
      `;

      const action = (planner as any).parseAction(llmResponse);

      expect(action.type).toBe('click');
      expect(action.selector).toBe('#submit-button');
    });

    it('should handle fill action with value', () => {
      const llmResponse = `{
        "type": "fill",
        "selector": "#email",
        "value": "test@example.com",
        "reasoning": "Fill email field"
      }`;

      const action = (planner as any).parseAction(llmResponse);

      expect(action.type).toBe('fill');
      expect(action.selector).toBe('#email');
      expect(action.value).toBe('test@example.com');
    });

    it('should fallback parse when JSON is invalid', () => {
      const llmResponse = 'Click on the button';

      const action = (planner as any).parseAction(llmResponse);

      expect(action.type).toBe('click');
    });
  });

  describe('formatObservation', () => {
    it('should format observation with elements', () => {
      const observation: ObservationData = {
        method: 'accessibility',
        url: 'https://example.com',
        elements: [
          { type: 'button', selector: '#submit', label: 'Submit' },
          { type: 'input', selector: '#email', label: 'Email', placeholder: 'Enter email' },
          { type: 'input', selector: '#password', label: 'Password' },
        ],
        rawData: {},
        cost: 0,
      };

      const formatted = (planner as any).formatObservation(observation);

      expect(formatted).toContain('Found 3 interactive elements');
      expect(formatted).toContain('buttons:');
      expect(formatted).toContain('Submit');
      expect(formatted).toContain('inputs:');
      expect(formatted).toContain('Email');
    });

    it('should handle empty observation', () => {
      const observation: ObservationData = {
        method: 'dom',
        url: 'https://example.com',
        elements: [],
        rawData: {},
        cost: 0,
      };

      const formatted = (planner as any).formatObservation(observation);

      expect(formatted).toBe('No interactive elements found on the page.');
    });

    it('should limit elements display', () => {
      const elements = Array.from({ length: 10 }, (_, i) => ({
        type: 'button',
        selector: `#btn-${i}`,
        label: `Button ${i}`,
      }));

      const observation: ObservationData = {
        method: 'accessibility',
        url: 'https://example.com',
        elements,
        rawData: {},
        cost: 0,
      };

      const formatted = (planner as any).formatObservation(observation);

      expect(formatted).toContain('and 5 more');
    });
  });

  describe('buildPrompt', () => {
    it('should include instruction in prompt', () => {
      const instruction = 'Navigate to LinkedIn and login';
      const observation: ObservationData = {
        method: 'accessibility',
        url: 'https://linkedin.com',
        elements: [],
        rawData: {},
        cost: 0,
      };

      const prompt = (planner as any).buildPrompt(
        instruction,
        'https://linkedin.com',
        observation,
        [],
        1
      );

      expect(prompt).toContain(instruction);
      expect(prompt).toContain('Current URL: https://linkedin.com');
    });

    it('should include LinkedIn login instructions', () => {
      const prompt = (planner as any).buildPrompt(
        'Login to LinkedIn',
        'https://linkedin.com',
        { method: 'dom', elements: [], rawData: {}, cost: 0 },
        [],
        1
      );

      expect(prompt).toContain('IMPORTANT INSTRUCTIONS FOR LOGIN/AUTHENTICATION');
      expect(prompt).toContain('${LINKEDIN_EMAIL}');
      expect(prompt).toContain('${LINKEDIN_PASSWORD}');
    });

    it('should include step history', () => {
      const stepHistory: Action[] = [
        { type: 'navigate', url: 'https://linkedin.com' },
        { type: 'click', selector: '#login-button' },
      ];

      const prompt = (planner as any).buildPrompt(
        'Continue login',
        'https://linkedin.com/login',
        { method: 'dom', elements: [], rawData: {}, cost: 0 },
        stepHistory,
        1
      );

      expect(prompt).toContain('Steps completed so far:');
      expect(prompt).toContain('navigate');
      expect(prompt).toContain('click');
    });

    it('should indicate retry attempts', () => {
      const prompt = (planner as any).buildPrompt(
        'Login',
        'https://linkedin.com',
        { method: 'dom', elements: [], rawData: {}, cost: 0 },
        [],
        3
      );

      expect(prompt).toContain('This is attempt #3 - previous attempt failed');
    });
  });
});
