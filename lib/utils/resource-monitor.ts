import { resourceLimits } from '../config/index.js';
import { TimeUtils } from './time-utils.js';
import { logger } from '../observability/logger.js';

export class ResourceMonitor {
  checkLimits(): { allowed: boolean; reason?: string } {
    const limits = TimeUtils.isNighttime()
      ? resourceLimits.nighttime.limits
      : resourceLimits.daytime.limits;

    // Check CPU
    const cpuUsage = this.getCPUUsage();
    if (cpuUsage > limits.maxCpuPercent) {
      return {
        allowed: false,
        reason: `CPU usage (${cpuUsage}%) exceeds limit (${limits.maxCpuPercent}%)`,
      };
    }

    // Check RAM
    const ramUsage = this.getRAMUsageGB();
    if (ramUsage > limits.maxRamGB) {
      return {
        allowed: false,
        reason: `RAM usage (${ramUsage}GB) exceeds limit (${limits.maxRamGB}GB)`,
      };
    }

    // Check emergency limits
    if (cpuUsage > resourceLimits.emergency.killIfCpuAbove) {
      logger.error('Emergency: CPU usage too high, killing process', { cpuUsage });
      process.exit(1);
    }

    if (ramUsage > resourceLimits.emergency.killIfRamAbove) {
      logger.error('Emergency: RAM usage too high, killing process', { ramUsage });
      process.exit(1);
    }

    return { allowed: true };
  }

  private getCPUUsage(): number {
    const cpus = process.cpuUsage();
    const total = cpus.user + cpus.system;
    // Convert to percentage (rough approximation)
    return Math.round((total / 1000000) * 100) / 100;
  }

  private getRAMUsageGB(): number {
    const usage = process.memoryUsage();
    return Math.round((usage.heapUsed / 1024 / 1024 / 1024) * 100) / 100;
  }

  getResourceInfo() {
    return {
      cpu: this.getCPUUsage(),
      ram: this.getRAMUsageGB(),
      isNighttime: TimeUtils.isNighttime(),
      limits: TimeUtils.isNighttime()
        ? resourceLimits.nighttime.limits
        : resourceLimits.daytime.limits,
    };
  }
}

export const resourceMonitor = new ResourceMonitor();
