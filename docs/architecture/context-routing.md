# Context and Project Routing

Status: proposed.

## Principle

Browser Gateway is a browser capability, not the system of record for Juan's knowledge.

It must not hard-code CV facts, marketing content, client data or project state. Context selection belongs to OrquestadorZao (or another trusted caller) and the authoritative project remains the source of truth.

## Responsibility split

```text
User / Zavi / Coding Agent
          |
          v
     OrquestadorZao
  classify task + resolve context
          |
   +------+-------------------+
   |                          |
   v                          v
Knowledge source          Browser Gateway
(project/repo/store)      navigate/interact
   |                          |
   +------------+-------------+
                v
         ContextBundle
                |
                v
        Research/Task Agent
```

## Initial authoritative sources

### Career / CV / interview knowledge

Authority: `jagzao/interview_nail` plus any explicit career-memory/database adapters owned by that project.

Examples:

- CV/profile facts;
- professional experience;
- skills and technology claims;
- interview preparation;
- job-fit evaluation;
- application answers;
- salary/role preferences where explicitly stored and permitted.

The Browser Gateway receives only the minimum sanitized context required for the current task. It does not crawl the entire repository for every browser action.

### Marketing and social publishing

Authority: `jagzao/Marketing`.

The repository already models Facebook, Instagram, LinkedIn, WhatsApp and other social integrations, content generation, scheduled publication, clients and analytics. Official platform APIs owned by Marketing should remain the preferred write path when available.

Browser automation is used for:

- read/research workflows;
- admin UI tasks not available in an API;
- verification/QA;
- approved compatibility fallbacks.

It should not replace a stable official API merely because a logged-in browser session exists.

### Project development knowledge

Authority: the target project's own repository and agent workspace.

Examples:

- feature/spec implementation -> target repo;
- code/CI/debugging -> target repo;
- browser QA of that project -> target repo context + Browser Gateway execution.

### Cross-project/global control knowledge

Authority: `jagzao/OrquestadorZao`.

Examples:

- project registry;
- capability routing;
- automation policy;
- project-to-agent mapping;
- global fallback and cost policies.

## Task classification examples

| Intent | Context authority | Browser session/capability |
|---|---|---|
| Find jobs matching Juan's CV | Interview Nail | public research + optional LinkedIn session |
| Fill a job application draft | Interview Nail | authenticated job-site session; submission requires approval |
| Prepare interview answers | Interview Nail | web research when required |
| Research content ideas for a client | Marketing | deep research, usually public web |
| Publish a Facebook post | Marketing | Meta API preferred; browser fallback requires approval |
| Inspect Facebook Business configuration | Marketing | authenticated Facebook session |
| Operate Azure portal for a project | target project + OrquestadorZao | authenticated Microsoft/Azure session; destructive actions gated |
| Research a technical library | target project | public deep research |
| General investigation not tied to a project | OrquestadorZao | public deep research |

## ContextBundle contract

The caller should pass a bounded context object rather than giving Browser Gateway unrestricted repository access.

Conceptual shape:

```json
{
  "taskId": "...",
  "intent": "career.job_search",
  "sourceProject": "interview_nail",
  "contextRefs": [
    "career://profile/current",
    "career://experience/verified",
    "career://job-preferences/current"
  ],
  "allowedCapabilities": ["research.web", "browser.linkedin.read"],
  "sensitivity": "personal",
  "approvalPolicy": "external_side_effects"
}
```

The Browser Gateway should not persist the entire bundle unless needed for execution auditing. Sensitive values should be minimized/redacted.

## Knowledge freshness

The authoritative project decides freshness rules. Browser Gateway does not silently overwrite knowledge based on a webpage.

Research results should return evidence/proposals to the calling project. The owning project decides whether new facts become durable knowledge.

Example:

```text
LinkedIn research finds new skill requirement
        |
        v
Research report -> Interview Nail
        |
        v
career agent/user validates
        |
        v
optional durable update
```

## Write boundary

Browser Gateway may perform browser side effects only under its safety/approval policy. It does not directly edit Interview Nail or Marketing repositories unless separately granted a repository capability by OrquestadorZao.

This keeps browser compromise, prompt injection or a malicious page from automatically becoming code/knowledge-store compromise.

## Prompt-injection boundary

All webpage text is untrusted data.

A webpage may not:

- change system/project policies;
- request secrets from the vault;
- expand allowed domains/capabilities;
- authorize a publish/send/purchase/apply action;
- instruct the agent to modify unrelated repositories.

Instructions originating from page content are evidence/content, never trusted orchestration instructions.
