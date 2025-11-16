export class TimeUtils {
  static isNighttime(): boolean {
    const hour = new Date().getHours();
    // Nighttime: 22:00 (10 PM) to 06:00 (6 AM)
    return hour >= 22 || hour < 6;
  }

  static isDaytime(): boolean {
    return !this.isNighttime();
  }

  static isInTimeRange(start: string, end: string): boolean {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;

    const [startHour, startMinute] = start.split(':').map(Number);
    const [endHour, endMinute] = end.split(':').map(Number);
    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    if (startTime < endTime) {
      // Same day range (e.g., 09:00-17:00)
      return currentTime >= startTime && currentTime <= endTime;
    } else {
      // Overnight range (e.g., 22:00-06:00)
      return currentTime >= startTime || currentTime <= endTime;
    }
  }

  static getDelayUntilNight(): number {
    const now = new Date();
    const tonight = new Date();
    tonight.setHours(22, 0, 0, 0);

    if (now.getHours() >= 22 || now.getHours() < 6) {
      // Ya es de noche, ejecutar ahora
      return 0;
    }

    if (now > tonight) {
      // Ya pasó las 10pm de hoy, programar para mañana
      tonight.setDate(tonight.getDate() + 1);
    }

    return tonight.getTime() - now.getTime();
  }

  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return this.sleep(delay);
  }
}
