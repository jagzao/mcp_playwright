import { Page } from 'playwright';
import { logger } from '../../../lib/observability/logger.js';

export interface ProfileAnalysisResult {
  completeness: number; // 0-100%
  sections: {
    [key: string]: {
      present: boolean;
      score: number;
      suggestions: string[];
    };
  };
  overallSuggestions: string[];
  strengths: string[];
  weaknesses: string[];
}

export class ProfileAnalyzer {
  /**
   * Analyze LinkedIn profile from current page
   */
  async analyzeProfile(page: Page): Promise<ProfileAnalysisResult> {
    try {
      logger.info('Starting profile analysis');

      // Extract profile data from page
      const profileData = await this.extractProfileData(page);

      // Analyze each section
      const sections = {
        headline: this.analyzeHeadline(profileData.headline),
        about: this.analyzeAbout(profileData.about),
        experience: this.analyzeExperience(profileData.experience),
        education: this.analyzeEducation(profileData.education),
        skills: this.analyzeSkills(profileData.skills),
        recommendations: this.analyzeRecommendations(profileData.recommendations),
        profilePhoto: this.analyzeProfilePhoto(profileData.hasPhoto),
      };

      // Calculate overall completeness
      const completeness = this.calculateCompleteness(sections);

      // Generate overall suggestions
      const overallSuggestions = this.generateOverallSuggestions(sections);

      // Identify strengths and weaknesses
      const strengths = this.identifyStrengths(sections);
      const weaknesses = this.identifyWeaknesses(sections);

      const result: ProfileAnalysisResult = {
        completeness,
        sections,
        overallSuggestions,
        strengths,
        weaknesses,
      };

      logger.info('Profile analysis complete', {
        completeness,
        sectionCount: Object.keys(sections).length,
      });

      return result;
    } catch (error: any) {
      logger.error('Profile analysis failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Extract profile data from LinkedIn page
   */
  private async extractProfileData(page: Page): Promise<any> {
    return await page.evaluate(() => {
      const data: any = {};

      // Extract headline
      const headlineEl = document.querySelector('.text-body-medium');
      data.headline = headlineEl?.textContent?.trim() || '';

      // Extract about section
      const aboutEl = document.querySelector('#about');
      data.about = aboutEl?.textContent?.trim() || '';

      // Check if profile photo exists
      const photoEl = document.querySelector('img[data-ghost-classes*="profile"]');
      data.hasPhoto = !!photoEl;

      // Extract experience count
      const experienceSection = document.querySelector('#experience');
      const experienceItems = experienceSection?.querySelectorAll('li.artdeco-list__item') || [];
      data.experience = {
        count: experienceItems.length,
        hasDescriptions: Array.from(experienceItems).some(
          (item) => item.textContent && item.textContent.length > 100
        ),
      };

      // Extract education count
      const educationSection = document.querySelector('#education');
      const educationItems = educationSection?.querySelectorAll('li.artdeco-list__item') || [];
      data.education = {
        count: educationItems.length,
      };

      // Extract skills count
      const skillsSection = document.querySelector('#skills');
      const skillsItems = skillsSection?.querySelectorAll('li') || [];
      data.skills = {
        count: skillsItems.length,
      };

      // Extract recommendations count
      const recommendationsSection = document.querySelector('#recommendations');
      data.recommendations = {
        count: recommendationsSection ? 1 : 0, // Simplified check
      };

      return data;
    });
  }

  private analyzeHeadline(headline: string) {
    const score = headline.length >= 30 ? 100 : (headline.length / 30) * 100;
    const suggestions = [];

    if (headline.length < 30) {
      suggestions.push('Expand your headline to at least 30 characters');
    }
    if (!headline.includes('|') && !headline.includes('-')) {
      suggestions.push('Consider adding keywords separated by | or -');
    }

    return {
      present: headline.length > 0,
      score: Math.round(score),
      suggestions,
    };
  }

  private analyzeAbout(about: string) {
    const minLength = 200;
    const score = Math.min((about.length / minLength) * 100, 100);
    const suggestions = [];

    if (about.length === 0) {
      suggestions.push('Add an About section to describe yourself');
    } else if (about.length < minLength) {
      suggestions.push(`Expand About section (currently ${about.length} chars, recommended ${minLength}+)`);
    }

    return {
      present: about.length > 0,
      score: Math.round(score),
      suggestions,
    };
  }

  private analyzeExperience(experience: any) {
    const score = Math.min((experience.count / 3) * 100, 100);
    const suggestions = [];

    if (experience.count === 0) {
      suggestions.push('Add your work experience');
    } else if (experience.count < 3) {
      suggestions.push('Add more experience entries (aim for 3+ recent positions)');
    }

    if (!experience.hasDescriptions) {
      suggestions.push('Add detailed descriptions to your experience entries');
    }

    return {
      present: experience.count > 0,
      score: Math.round(score),
      suggestions,
    };
  }

  private analyzeEducation(education: any) {
    const score = education.count > 0 ? 100 : 0;
    const suggestions = [];

    if (education.count === 0) {
      suggestions.push('Add your education background');
    }

    return {
      present: education.count > 0,
      score,
      suggestions,
    };
  }

  private analyzeSkills(skills: any) {
    const minSkills = 5;
    const score = Math.min((skills.count / minSkills) * 100, 100);
    const suggestions = [];

    if (skills.count === 0) {
      suggestions.push('Add skills to your profile');
    } else if (skills.count < minSkills) {
      suggestions.push(`Add more skills (currently ${skills.count}, recommended ${minSkills}+)`);
    }

    return {
      present: skills.count > 0,
      score: Math.round(score),
      suggestions,
    };
  }

  private analyzeRecommendations(recommendations: any) {
    const score = recommendations.count > 0 ? 100 : 0;
    const suggestions = [];

    if (recommendations.count === 0) {
      suggestions.push('Request recommendations from colleagues');
    }

    return {
      present: recommendations.count > 0,
      score,
      suggestions,
    };
  }

  private analyzeProfilePhoto(hasPhoto: boolean) {
    return {
      present: hasPhoto,
      score: hasPhoto ? 100 : 0,
      suggestions: hasPhoto ? [] : ['Add a professional profile photo'],
    };
  }

  private calculateCompleteness(sections: any): number {
    const scores = Object.values(sections).map((s: any) => s.score);
    const average = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
    return Math.round(average);
  }

  private generateOverallSuggestions(sections: any): string[] {
    const suggestions = [];
    const completeness = this.calculateCompleteness(sections);

    if (completeness < 50) {
      suggestions.push('🔴 Your profile needs significant improvements');
    } else if (completeness < 75) {
      suggestions.push('🟡 Your profile is decent but has room for improvement');
    } else {
      suggestions.push('🟢 Your profile is well-optimized!');
    }

    // Priority suggestions
    if (!sections.profilePhoto.present) {
      suggestions.push('⚠️ HIGH PRIORITY: Add a profile photo');
    }
    if (!sections.headline.present || sections.headline.score < 50) {
      suggestions.push('⚠️ HIGH PRIORITY: Improve your headline');
    }
    if (!sections.about.present) {
      suggestions.push('⚠️ HIGH PRIORITY: Add an About section');
    }

    return suggestions;
  }

  private identifyStrengths(sections: any): string[] {
    const strengths: string[] = [];

    Object.entries(sections).forEach(([key, section]: [string, any]) => {
      if (section.score >= 80) {
        strengths.push(`✅ ${key}: ${section.score}%`);
      }
    });

    return strengths;
  }

  private identifyWeaknesses(sections: any): string[] {
    const weaknesses: string[] = [];

    Object.entries(sections).forEach(([key, section]: [string, any]) => {
      if (section.score < 50) {
        weaknesses.push(`❌ ${key}: ${section.score}%`);
      }
    });

    return weaknesses;
  }

  /**
   * Generate a human-readable report
   */
  generateReport(analysis: ProfileAnalysisResult): string {
    const lines = [];

    lines.push('='.repeat(60));
    lines.push('📊 LINKEDIN PROFILE ANALYSIS REPORT');
    lines.push('='.repeat(60));
    lines.push('');
    lines.push(`Overall Completeness: ${analysis.completeness}%`);
    lines.push('');

    // Overall suggestions
    lines.push('💡 OVERALL SUGGESTIONS:');
    analysis.overallSuggestions.forEach((s) => lines.push(`  ${s}`));
    lines.push('');

    // Strengths
    if (analysis.strengths.length > 0) {
      lines.push('💪 STRENGTHS:');
      analysis.strengths.forEach((s) => lines.push(`  ${s}`));
      lines.push('');
    }

    // Weaknesses
    if (analysis.weaknesses.length > 0) {
      lines.push('⚠️  AREAS TO IMPROVE:');
      analysis.weaknesses.forEach((s) => lines.push(`  ${s}`));
      lines.push('');
    }

    // Detailed section analysis
    lines.push('📋 SECTION-BY-SECTION ANALYSIS:');
    Object.entries(analysis.sections).forEach(([key, section]) => {
      lines.push(`  ${key}: ${section.score}% ${section.present ? '✓' : '✗'}`);
      if (section.suggestions.length > 0) {
        section.suggestions.forEach((s) => lines.push(`    → ${s}`));
      }
    });

    lines.push('');
    lines.push('='.repeat(60));

    return lines.join('\n');
  }
}
