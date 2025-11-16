import { Metrics } from '../types/index.js';

export class MetricsCollector {
  private metrics: Metrics = {
    tasksCompleted: 0,
    tasksFailed: 0,
    llmCalls: 0,
    cacheHits: 0,
    cacheMisses: 0,
    avgTaskDuration: 0,
    errorsByType: new Map<string, number>(),
    actionsByType: new Map<string, number>(),
  };

  private taskDurations: number[] = [];

  recordTaskComplete(duration: number) {
    this.metrics.tasksCompleted++;
    this.updateAvgDuration(duration);
  }

  recordTaskFailed(duration: number) {
    this.metrics.tasksFailed++;
    this.updateAvgDuration(duration);
  }

  private updateAvgDuration(duration: number) {
    this.taskDurations.push(duration);
    const sum = this.taskDurations.reduce((a, b) => a + b, 0);
    this.metrics.avgTaskDuration = sum / this.taskDurations.length;
  }

  recordLLMCall(cached: boolean) {
    this.metrics.llmCalls++;
    if (cached) {
      this.metrics.cacheHits++;
    } else {
      this.metrics.cacheMisses++;
    }
  }

  recordError(type: string) {
    const count = this.metrics.errorsByType.get(type) || 0;
    this.metrics.errorsByType.set(type, count + 1);
  }

  recordAction(type: string) {
    const count = this.metrics.actionsByType.get(type) || 0;
    this.metrics.actionsByType.set(type, count + 1);
  }

  getCacheHitRate(): number {
    const total = this.metrics.cacheHits + this.metrics.cacheMisses;
    return total > 0 ? this.metrics.cacheHits / total : 0;
  }

  getSuccessRate(): number {
    const total = this.metrics.tasksCompleted + this.metrics.tasksFailed;
    return total > 0 ? this.metrics.tasksCompleted / total : 0;
  }

  getMetrics(): Metrics {
    return { ...this.metrics };
  }

  // Exportar métricas en formato Prometheus
  exportPrometheus(): string {
    return `
# HELP tasks_completed Total tasks completed
# TYPE tasks_completed counter
tasks_completed ${this.metrics.tasksCompleted}

# HELP tasks_failed Total tasks failed
# TYPE tasks_failed counter
tasks_failed ${this.metrics.tasksFailed}

# HELP llm_calls_total Total LLM calls
# TYPE llm_calls_total counter
llm_calls_total ${this.metrics.llmCalls}

# HELP cache_hit_rate Cache hit rate
# TYPE cache_hit_rate gauge
cache_hit_rate ${this.getCacheHitRate()}

# HELP avg_task_duration Average task duration in seconds
# TYPE avg_task_duration gauge
avg_task_duration ${this.metrics.avgTaskDuration}

# HELP success_rate Task success rate
# TYPE success_rate gauge
success_rate ${this.getSuccessRate()}
    `.trim();
  }

  // Dashboard en consola
  printDashboard() {
    const pad = (value: any, width = 6): string => String(value).padStart(width);

    const topErrors = Array.from(this.metrics.errorsByType.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => `║   - ${type}: ${count}`)
      .join('\n');

    console.log(`
╔═══════════════════════════════════════════════╗
║           📊 METRICS DASHBOARD               ║
╠═══════════════════════════════════════════════╣
║ Tasks Completed:    ${pad(this.metrics.tasksCompleted)}              ║
║ Tasks Failed:       ${pad(this.metrics.tasksFailed)}              ║
║ Success Rate:       ${pad((this.getSuccessRate() * 100).toFixed(1))}%           ║
║                                               ║
║ LLM Calls:          ${pad(this.metrics.llmCalls)}              ║
║ Cache Hits:         ${pad(this.metrics.cacheHits)}              ║
║ Cache Hit Rate:     ${pad((this.getCacheHitRate() * 100).toFixed(1))}%           ║
║                                               ║
║ Avg Duration:       ${pad(this.metrics.avgTaskDuration.toFixed(1))}s            ║
║                                               ║
║ Top Errors:                                   ║
${topErrors || '║   - None'}
╚═══════════════════════════════════════════════╝
    `);
  }

  reset() {
    this.metrics = {
      tasksCompleted: 0,
      tasksFailed: 0,
      llmCalls: 0,
      cacheHits: 0,
      cacheMisses: 0,
      avgTaskDuration: 0,
      errorsByType: new Map<string, number>(),
      actionsByType: new Map<string, number>(),
    };
    this.taskDurations = [];
  }
}

export const metrics = new MetricsCollector();
